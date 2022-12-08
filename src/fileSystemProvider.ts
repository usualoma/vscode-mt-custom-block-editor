import * as path from 'path';
import * as vscode from 'vscode';
import { TextEncoder, TextDecoder } from 'util';

export class File implements vscode.FileStat {

	type: vscode.FileType;
	ctime: number;
	mtime: number;
	size: number;
  name: string;
  
	constructor(name: string) {
		this.type = vscode.FileType.File;
		this.ctime = Date.now();
		this.mtime = Date.now();
    this.size = 0;
		this.name = name;
	}
}

export class MTCustomBlockFS implements vscode.FileSystemProvider {
	stat(uri: vscode.Uri): vscode.FileStat {
    return new File(uri.path);
	}

	readDirectory(uri: vscode.Uri): [string, vscode.FileType][] {
    throw vscode.FileSystemError.FileNotFound(uri);
	}

	async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const fileUri = vscode.Uri.parse(`file:${uri.path.replace(/.preview_header.html$/, '')}`);
    const binData = await vscode.workspace.fs.readFile(fileUri);
    const data = JSON.parse(new TextDecoder().decode(binData));
    return new TextEncoder().encode(data["preview_header"] ?? "");
	}

	async writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean, overwrite: boolean }): Promise<void> {
    const fileUri = vscode.Uri.parse(`file:${uri.path.replace(/.preview_header.html$/, '')}`);
    const binData = await vscode.workspace.fs.readFile(fileUri);
    const data = JSON.parse(new TextDecoder().decode(binData));
    data["preview_header"] = new TextDecoder().decode(content);
    await vscode.workspace.fs.writeFile(fileUri, new TextEncoder().encode(JSON.stringify(data)));
    this._emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
	}

	// --- manage files/folders

	rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean }): void {
    throw vscode.FileSystemError.FileNotFound(newUri);
	}

	delete(uri: vscode.Uri): void {
    throw vscode.FileSystemError.FileNotFound(uri);
	}

	createDirectory(uri: vscode.Uri): void {
    throw vscode.FileSystemError.FileNotFound(uri);
	}

  private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._emitter.event;
  
	watch(_resource: vscode.Uri): vscode.Disposable {
		// ignore, fires for all changes...
		return new vscode.Disposable(() => { });
	}
}
