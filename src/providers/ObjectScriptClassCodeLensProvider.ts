import * as vscode from "vscode";
import { config } from "../extension";
import { currentFile } from "../utils";

export class ObjectScriptClassCodeLensProvider implements vscode.CodeLensProvider {
  public provideCodeLenses(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.CodeLens[]> {
    const result = new Array<vscode.CodeLens>();

    const isClass = document.fileName.toLowerCase().endsWith(".cls");

    if (isClass) {
      result.push(...this.classMethods(document));
    }
    return result;
  }

  private classMethods(document: vscode.TextDocument): vscode.CodeLens[] {
    const file = currentFile(document);
    const result = new Array<vscode.CodeLens>();

    if (file.name.match(/\.cls$/i)) {
      const className = file.name.split(".").slice(0, -1).join(".");

      let inComment = false;
      for (let i = 0; i < document.lineCount; i++) {
        const line = document.lineAt(i);
        const text = this.stripLineComments(line.text);

        if (text.match(/\/\*/)) {
          inComment = true;
        }

        if (inComment) {
          if (text.match(/\*\//)) {
            inComment = false;
          }
          continue;
        }

        const { debugThisMethod } = config("debug");
        const methodMatch = text.match(/(?<=^ClassMethod\s)([^(]+)(\(.)/i);
        if (methodMatch) {
          const [, name, parens] = methodMatch;
          const program = `##class(${className}).${name}`;
          const askArgs = parens !== "()";
          if (debugThisMethod) {
            result.push(
              new vscode.CodeLens(
                new vscode.Range(
                  new vscode.Position(i, methodMatch.index),
                  new vscode.Position(i, methodMatch.index + name.length)
                ),
                {
                  title: `Debug this method`,
                  command: "vscode-objectscript.debug",
                  arguments: [program, askArgs],
                }
              )
            );
          }
        }
      }
    }
    return result;
  }

  private stripLineComments(text: string) {
    text = text.replace(/\/\/.*$/, "");
    text = text.replace(/#+;.*$/, "");
    text = text.replace(/;.*$/, "");
    return text;
  }
}
