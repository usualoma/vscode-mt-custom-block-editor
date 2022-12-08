import * as vscode from "vscode";
import { posix } from "path";
import { TextDecoder } from "util";
import { encode as encodeHtml } from "html-entities";
import { MTCustomBlockFS } from "./fileSystemProvider";
import { readFile } from "fs";

const panels: Record<string, vscode.WebviewPanel> = {};

function getWebviewOptions(extensionUri: vscode.Uri): vscode.WebviewOptions {
  return {
    // Enable javascript in the webview
    enableScripts: true,

    // And restrict the webview to only loading content from our extension's `media` directory.
    localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")],
  };
}

function getNonce() {
  let text = "";
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

function isMTBlockEditorCustomBlockJSON(data: Record<string, any>) {
  return (
    data &&
    typeof data === "object" &&
    [
      "preview_header",
      "identifier",
      "can_remove_block",
      "wrap_root_block",
    ].every((key) => key in data)
  );
}

function getHtmlForWebview(
  extensionUri: vscode.Uri,
  webview: vscode.Webview,
  customBlocks: Record<string, any>[]
) {
  const mediaUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "media")
  );

  const customBlocksJSON = JSON.stringify(
    customBlocks.map((b) => {
      const types: Record<string, any> = [];
      for (const k of Object.keys(b.block_display_options)) {
        const v = b.block_display_options[k];
        types.push({
          typeId: k,
          order: v.order,
          panel: v.panel,
          shortcut: v.shortcut,
        });
      }
      return {
        typeId: `custom-${b.identifier}`,
        className: b.class_name,
        label: b.label,
        icon: b.icon,
        html: b.html,
        canRemoveBlock: b.can_remove_block,
        rootBlock: b.wrap_root_block ? "div" : "",
        previewHeader: b.preview_header,
        shouldBeCompiled: !!b.preview_header.match(/<\s*script/i),
        addableBlockTypes: {
          common: types.sort((a: any, b: any) => a.order - b.order),
        },
        showPreview: b.show_preview,
      };
    })
  );
  const blockTypes = JSON.stringify(
    customBlocks.map((b) => `custom-${b.identifier}`)
  );

  // Use a nonce to only allow specific scripts to be run
  // const nonce = getNonce();

  return `<!DOCTYPE html>
  <html lang="ja">
    <head>
      <meta charset="UTF-8" />
      <title></title>
      <meta name="keywords" content="" />
      <meta name="description" content="" />
      <meta
        name="viewport"
        content="width=device-width, initial-scale=1, shrink-to-fit=no"
      />
      <link
        rel="stylesheet"
        href="https://stackpath.bootstrapcdn.com/bootstrap/4.3.1/css/bootstrap.min.css"
        integrity="sha384-ggOyR0iXCbMQv3Xipma34MD+dH/1fQ784/j6cY/iJTQUOhcWr7x9JvoRxT2MZw1T"
        crossorigin="anonymous"
      />
      <style type="text/css">
        body > div {
          margin: 10px 200px;
        }
        @media (max-width: 991.5px) {
          body > div {
            margin: 0;
          }
        }
      </style>
      <script
        src="${mediaUri}/tinymce6/js/tinymce/tinymce.min.js"
        referrerpolicy="origin"
      ></script>
    </head>
    <body>
      <div>
        <form style="margin-top: 80px;">
          <textarea id="body"></textarea>
          <br />
          <input type="submit" id="submit" value="Save" />
          <!--
          <input type="reset" id="reset" />
          <input type="submit" id="unload" value="Unload" />
          <input type="submit" id="toggle-mode" value="Toggle mode" />
          -->
        </form>
      </div>
      <div data-blocks="${encodeHtml(
        customBlocksJSON
      )}" data-block-types="${encodeHtml(blockTypes)}"></div>
      <script type="module">
        const applyOpts = {
          mode: sessionStorage.getItem("MTBlockEditorMode") || "composition",
          id: "body",
          stylesheets: [
            (() => {
              const a = document.createElement("a");
              a.href = "${mediaUri}/editor-content.css";
              return a.href;
            })(),
          ],
          i18n: {
            lng: "ja",
            debug: true,
          },
          shortcutBlockTypes: ["core-text", "core-image", "core-file"],
          // panelBlockTypes: [
          //   "core-text",
          //   "core-image",
          //   "core-file",
          //   "core-horizontalrule",
          //   "core-html",
          //   "core-table",
          //   "core-columns",
          // ],
        };
  
        window.document.getElementById("body").value =
          window.sessionStorage.getItem("MTBlockEditorBody") || "";
  
        const ts = new Date().getTime();
        const loader = [
          "${mediaUri}/dist/mt-block-editor.js",
          // "${mediaUri}/register-block.js",
          "${mediaUri}/dist/mt-block-editor-block-form-element/mt-block-editor-block-form-element.js",
          // "${mediaUri}/blocks-officer.html",
        ].reduce(
          (chain, m) =>
            chain.then(() => {
              if (m.match(/\\.html/)) {
                return fetch(m)
                  .then((res) => res.text())
                  .then((html) => {
                    const t = document.createElement("template");
                    t.innerHTML = html;
                    document.body.appendChild(t.content);
                  });
              } else {
                return import(\`\${m}?ts=\${ts}\`);
              }
            }),
          Promise.resolve()
        );
  
        if (/^localhost(?::|$)/.test(location.host)) {
          // Probably in the development environment.
        } else {
          ["${mediaUri}/dist/mt-block-editor.css"].forEach((url) => {
            const link = window.document.createElement("link");
            link.rel = "stylesheet";
            link.href = \`\${url}?ts=\${ts}\`;
            window.document.querySelector("head").appendChild(link);
          });
        }
  
        loader
          .then(async () => {
            const blocksElm = document.querySelector(
              \`[data-block-types][data-blocks]\`
            );
            const blockTypes = blocksElm && blocksElm.dataset.blockTypes;
            const blocks = blocksElm && blocksElm.dataset.blocks;
            if (!(blocks && blockTypes)) {
              return;
            }
            const { registerBoilerplateBlocks } = await import(
              \`${mediaUri}/dist/register-boilerplate-blocks.js?ts=\${ts}\`
            );
  
            registerBoilerplateBlocks(
              window.MTBlockEditor,
              JSON.parse(blockTypes),
              JSON.parse(blocks)
            );
            Reflect.deleteProperty(applyOpts, "panelBlockTypes");
          })
          .then(() => {
            return window;
          })
          .then(({ MTBlockEditor, sessionStorage, document }) => {
            MTBlockEditor.apply(applyOpts).then((ed) => {
              ed.on("initializeBlocks", ({ blocks }) => {
                console.log(blocks);
              });
              ed.on("buildTinyMCESettings", ({ block, settings }) => {
                console.log(block.constructor.typeId);
                settings.extended_valid_elements = [
                  // we embed 'a[onclick]' by inserting image with popup
                  \`a[id|class|style|title|accesskey|tabindex|lang|dir|draggable|dropzone|contextmenu|hidden|onclick|href|target|name]\`,
                  // allow SPAN element without attributes
                  \`span[id|class|style|title|accesskey|tabindex|lang|dir|draggable|dropzone|contextmenu|hidden|onclick]\`,
                  // allow SCRIPT element
                  "script[id|name|type|src]",
                ].join(",");
                settings.valid_children = "+a[div]";
              });
            });
  
            document
              .getElementById("submit")
              .form.addEventListener("submit", function (ev) {
                ev.preventDefault();
                MTBlockEditor.serialize().then(function () {
                  console.log("serialized");
                  sessionStorage.setItem(
                    "MTBlockEditorBody",
                    document.querySelector("#body").value
                  );
                });
              });
  
            document
              .getElementById("reset")
              .addEventListener("click", function (ev) {
                ev.preventDefault();
                sessionStorage.setItem("MTBlockEditorBody", "");
                location.reload();
              });
  
            document
              .getElementById("unload")
              .addEventListener("click", function (ev) {
                ev.preventDefault();
                MTBlockEditor.unload({ id: "body" });
              });
  
            document
              .getElementById("toggle-mode")
              .addEventListener("click", function (ev) {
                ev.preventDefault();
  
                const cur =
                  sessionStorage.getItem("MTBlockEditorMode") || "composition";
                const next = cur === "composition" ? "setup" : "composition";
                sessionStorage.setItem("MTBlockEditorMode", next);
                location.reload();
              });
          });
      </script>
    </body>
  </html>`;
}

async function getCustomBlocks(folderUri: vscode.Uri) {
  const customBlocks: Record<string, any>[] = [];
  for (const [name, type] of await vscode.workspace.fs.readDirectory(
    folderUri
  )) {
    if (type !== vscode.FileType.File) {
      continue;
    }
    if (posix.extname(name) !== ".json") {
      continue;
    }

    const filePath = posix.join(folderUri.path, name);
    const binData = await vscode.workspace.fs.readFile(
      folderUri.with({ path: filePath })
    );
    const data = JSON.parse(new TextDecoder().decode(binData));

    if (isMTBlockEditorCustomBlockJSON(data)) {
      customBlocks.push(data);
    }
  }

  return customBlocks;
}

async function setContext(editor: vscode.TextEditor | undefined) {
  if (!editor) {
    return;
  }

  const uri = editor.document.uri;
  if (posix.extname(uri.path) !== ".json") {
    vscode.commands.executeCommand(
      "setContext",
      "isMTBlockEditorCustomBlockJSON",
      false
    );
    return;
  }

  const binData = await vscode.workspace.fs.readFile(uri);
  const data = JSON.parse(new TextDecoder().decode(binData));
  vscode.commands.executeCommand(
    "setContext",
    "isMTBlockEditorCustomBlockJSON",
    isMTBlockEditorCustomBlockJSON(data)
  );
}

export function activate(context: vscode.ExtensionContext) {
  setContext(vscode.window.activeTextEditor);
  vscode.window.onDidChangeActiveTextEditor(setContext);

  const fs = new MTCustomBlockFS();
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider("mt_custom_block_fs", fs, {
      isCaseSensitive: true,
    })
  );

  vscode.commands.registerCommand("fs/openMTCustomBlockFs", async function () {
    if (
      !vscode.window.activeTextEditor ||
      posix.extname(vscode.window.activeTextEditor.document.uri.path) !==
        ".json"
    ) {
      return vscode.window.showInformationMessage("Open a JSON file first");
    }

    const jsonUri = vscode.window.activeTextEditor.document.uri;
    const editorUri = vscode.Uri.parse(
      `mt_custom_block_fs:${jsonUri.path}.preview_header.html`
    );

    try {
      vscode.window.showTextDocument(editorUri, {
        viewColumn: vscode.window.activeTextEditor?.viewColumn,
      });
    } catch {
      vscode.window.showInformationMessage(
        `${editorUri.toString(true)} file does *not* exist`
      );
    }
  });

  vscode.workspace.onDidSaveTextDocument(async (document) => {
    const fileUri = document.uri;
    const folderPath = posix.dirname(fileUri.path);
    const folderUri = fileUri.with({ scheme: "file", path: folderPath });

    if (!panels[folderPath]) {
      return;
    }

    panels[folderPath].webview.html = getHtmlForWebview(
      context.extensionUri,
      panels[folderPath].webview,
      await getCustomBlocks(folderUri)
    );
  });
  vscode.commands.registerCommand(
    "mt-custom-block-editor-openBlockEditor",
    async function () {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }

      const fileUri = editor.document.uri;
      const folderPath = posix.dirname(fileUri.path);
      const folderUri = fileUri.with({ path: folderPath });

      if (!panels[folderPath]) {
        panels[folderPath] = vscode.window.createWebviewPanel(
          "MTBlockEditor",
          posix.basename(folderPath),
          vscode.ViewColumn.Beside,
          getWebviewOptions(context.extensionUri)
        );
        panels[folderPath].onDidDispose(() => {
          Reflect.deleteProperty(panels, folderPath);
        });
      }

      panels[folderPath].webview.html = getHtmlForWebview(
        context.extensionUri,
        panels[folderPath].webview,
        await getCustomBlocks(folderUri)
      );
    }
  );
}
