import * as vscode from "vscode";
import commands = require("./completion/commands.json");
import systemFunctions = require("./completion/systemFunctions.json");
import systemVariables = require("./completion/systemVariables.json");
import structuredSystemVariables = require("./completion/structuredSystemVariables.json");

export class ObjectScriptDiagnosticProvider {
  private _collection: vscode.DiagnosticCollection;

  public constructor() {
    this._collection = vscode.languages.createDiagnosticCollection("ObjectScript");
  }

  public updateDiagnostics(document: vscode.TextDocument): void {
    if (document.languageId.startsWith("objectscript")) {
      this._collection.set(document.uri, [
        ...this.classMembers(document),
        ...this.commands(document),
        ...this.functions(document),
      ]);
    }
  }

  private classMembers(document: vscode.TextDocument): vscode.Diagnostic[] {
    const result = new Array<vscode.Diagnostic>();
    const isClass = document.fileName.toLowerCase().endsWith(".cls");
    if (!isClass) {
      return [];
    }

    const map = new Map<string, string>();
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
      let skipNonLatin = false;

      const memberMatch = text.match(
        /^(Class|Property|Relationship|Index|(?:(?:Client)?(?:Class)?Method)|ClientClassMethod|Method|XData|Query|Trigger|ForeignKey|Projection|Parameter)\s((?:"[^"]+")|(?:[^ (;]+))/i
      );
      if (memberMatch) {
        const [fullMatch, type, name] = memberMatch;
        const simpleType = type.toLowerCase().replace("classmethod", "method").replace("relationship", "property");
        const key = simpleType === "class" ? simpleType : [simpleType, name].join(":");
        if (simpleType === "class") {
          if (!name.includes(".")) {
            const pos = line.text.indexOf(name);
            const range = new vscode.Range(new vscode.Position(i, pos), new vscode.Position(i, pos + name.length));
            result.push({
              code: "",
              message: "Class name is invalid",
              range,
              severity: vscode.DiagnosticSeverity.Error,
              source: "",
              relatedInformation: [
                new vscode.DiagnosticRelatedInformation(
                  new vscode.Location(document.uri, range),
                  `Class name '${name}' should have a package name prefix`
                ),
              ],
            });
          }
        }
        const notValid =
          simpleType !== "class" && name.startsWith('"') && name.endsWith('"')
            ? simpleType !== "class" && name.includes(".")
              ? "."
              : ""
            : name[0].replace(/[^\x21-\x2F\x3A-\x40\x5B-\x60\x7B-\x7E0-9]|%/g, "") +
              name
                .slice(1)
                .replace(simpleType === "class" ? /\./g : "", "")
                .replace(/[^\x21-\x2F\x3A-\x40\x5B-\x60\x7B-\x7E]/g, "");
        if (notValid !== "") {
          const pos = line.text.indexOf(name);
          const range = new vscode.Range(new vscode.Position(i, pos), new vscode.Position(i, pos + name.length));
          result.push({
            code: "",
            message: "Name is invalid",
            range,
            severity: vscode.DiagnosticSeverity.Error,
            source: "",
            relatedInformation: [
              new vscode.DiagnosticRelatedInformation(
                new vscode.Location(document.uri, range),
                `'${fullMatch}' contains invalid characters '${notValid}'`
              ),
            ],
          });
          skipNonLatin = true;
        }
        if (map.has(key)) {
          const original = map.get(key);
          const pos = line.text.indexOf(name);
          const range = new vscode.Range(new vscode.Position(i, pos), new vscode.Position(i, pos + name.length));
          result.push({
            code: "",
            message: "Element name conflict",
            range,
            severity: vscode.DiagnosticSeverity.Error,
            source: "",
            relatedInformation: [
              new vscode.DiagnosticRelatedInformation(
                new vscode.Location(document.uri, range),
                `'${original}' already defined earlier`
              ),
            ],
          });
        }
        map.set(key, fullMatch);

        let leftChars;
        if (
          !skipNonLatin &&
          !name.startsWith('"') &&
          (leftChars = name.replace(/[%a-z0-9.]/gi, "")) &&
          leftChars !== ""
        ) {
          const pos = line.text.indexOf(name);
          const range = new vscode.Range(new vscode.Position(i, pos), new vscode.Position(i, pos + name.length));
          result.push({
            code: "",
            message: "Non-latin characters",
            range,
            severity: vscode.DiagnosticSeverity.Warning,
            source: "",
            relatedInformation: [
              new vscode.DiagnosticRelatedInformation(
                new vscode.Location(document.uri, range),
                `Element name contains non-latin characters: ${leftChars}`
              ),
            ],
          });
        }
      }
    }

    return result;
  }

  private stripLineComments(text: string) {
    text = text.replace(/\/\/.*$/, "");
    text = text.replace(/#+;.*$/, "");
    text = text.replace(/;.*$/, "");
    text = text.replace(/\/\*.*(?=\*\/)\*\//g, (e) => e.replace(/./g, " "));
    return text;
  }

  /// replace value in double quotes by spaces
  private stripQuoted(text: string) {
    return text.replace(/"([^"]*(?="")"")*[^"]*"/g, (e) => '"' + e.replace(/./g, " ").slice(2) + '"');
  }

  private commands(document: vscode.TextDocument): vscode.Diagnostic[] {
    const result = new Array<vscode.Diagnostic>();
    const isClass = document.fileName.toLowerCase().endsWith(".cls");

    let inComment = false;
    let endingComma = false;
    let isCode = !isClass;
    let jsScript = false;
    let js = false;
    let html = false;
    let htmlParens = 0;
    let jsParens = 0;
    let sql = false;
    let sqlParens = 0;
    for (let i = 0; i < document.lineCount; i++) {
      const line = document.lineAt(i);
      let text = line.text;
      text = this.stripLineComments(text);
      text = this.stripQuoted(text);

      // it is important to check script tag context before ObjectScript comments
      // since /* ... */ comments can also be used in JavaScript
      if (text.match(/<script.*>/i)) {
        jsScript = true;
      }
      if (jsScript) {
        if (text.match(/<\/script>/i)) {
          jsScript = false;
        }
        continue;
      }

      if (text.match(/&js(cript)?/i)) {
        js = true;
        jsParens = 0;
      }
      if (js) {
        let noParensText = text;
        while (noParensText != (noParensText = noParensText.replace(/\([^()]*\)/g, "")));
        jsParens = jsParens + (noParensText.split("<").length - 1) - (noParensText.split(">").length - 1);
        if (jsParens <= 0) {
          js = false;
        }
        continue;
      }
      if (text.match(/&html/i)) {
        html = true;
        htmlParens = 0;
      }
      if (html) {
        htmlParens = htmlParens + (text.split("<").length - 1) - (text.split(">").length - 1);
        if (htmlParens <= 0) {
          html = false;
        }
        continue;
      }

      if (text.match(/(?:&|##)sql/i)) {
        sql = true;
        sqlParens = 0;
      }

      if (sql) {
        sqlParens = sqlParens + (text.split("(").length - 1) - (text.split(")").length - 1);
        if (sqlParens <= 0) {
          sql = false;
        }
        continue;
      }

      if (text.match(/\/\*/)) {
        inComment = true;
      }

      if (inComment) {
        if (text.match(/\*\//)) {
          inComment = false;
        }
        continue;
      }
      if (endingComma) {
        endingComma = text.match(/,\s*$/) !== null;
        continue;
      }
      endingComma = text.match(/,\s*$/) !== null;
      if (isClass) {
        if (isCode) {
          isCode = text.match(/^}$/) === null;
        } else {
          isCode = text.match(/^(class)?method|trigger/i) != null;
          continue;
        }
      }
      if (!isCode) {
        continue;
      }

      const commandsMatch = text.match(/^\s+(?:}\s)?\b([a-z]+)\b/i);
      if (commandsMatch) {
        const [, found] = commandsMatch;
        const pos = line.text.indexOf(found);
        const range = new vscode.Range(new vscode.Position(i, pos), new vscode.Position(i, pos + found.length));
        const command = commands.find((el) => el.alias.includes(found.toUpperCase()));
        if (!command) {
          result.push({
            code: "",
            message: "Unrecognized command",
            range,
            severity: found.toUpperCase().startsWith("Z")
              ? vscode.DiagnosticSeverity.Warning
              : vscode.DiagnosticSeverity.Error,
            relatedInformation: [
              new vscode.DiagnosticRelatedInformation(
                new vscode.Location(document.uri, range),
                `Command '${found}' not recognized`
              ),
            ],
          });
        }
      }
    }
    return result;
  }

  private functions(document: vscode.TextDocument): vscode.Diagnostic[] {
    const result = new Array<vscode.Diagnostic>();

    const isClass = document.fileName.toLowerCase().endsWith(".cls");

    let inComment = false;
    let isCode = !isClass;
    for (let i = 0; i < document.lineCount; i++) {
      const line = document.lineAt(i);
      let text = line.text;
      text = this.stripLineComments(text);
      text = this.stripQuoted(text);

      if (text.match(/\/\*/)) {
        inComment = true;
      }

      if (inComment) {
        if (text.match(/\*\//)) {
          inComment = false;
        }
        continue;
      }

      if (isClass) {
        if (isCode) {
          isCode = text.match(/^}$/) === null;
        } else {
          isCode = text.match(/^(class)?method|trigger/i) != null;
          continue;
        }
      }
      if (!isCode) {
        continue;
      }

      const pattern = /(?<!\$)(\$[a-z]+)/gi;
      let functionsMatch = null;
      while ((functionsMatch = pattern.exec(text)) !== null) {
        const [, found] = functionsMatch;
        const pos = functionsMatch.index;
        const range = new vscode.Range(new vscode.Position(i, pos), new vscode.Position(i, pos + found.length));
        const systemFunction: CompletionModel = [
          ...systemFunctions,
          ...systemVariables,
          ...structuredSystemVariables,
        ].find((el) => el.alias.includes(found.toUpperCase()));
        if (!systemFunction) {
          result.push({
            range,
            message: "Unrecognized system function/variable",
            severity: found.toUpperCase().startsWith("$Z")
              ? vscode.DiagnosticSeverity.Warning
              : vscode.DiagnosticSeverity.Error,
            relatedInformation: [
              new vscode.DiagnosticRelatedInformation(
                new vscode.Location(document.uri, range),
                `System function or variable '${found}' not recognized`
              ),
            ],
          });
        }
        if (systemFunction && systemFunction.deprecated) {
          result.push({
            range,
            code: systemFunction.code || "",
            severity: vscode.DiagnosticSeverity.Warning,
            message: "Deprecated system function/variable",
            tags: [vscode.DiagnosticTag.Deprecated],
            relatedInformation: [
              new vscode.DiagnosticRelatedInformation(
                new vscode.Location(document.uri, range),
                `System function or variable '${found}' deprecated`
              ),
            ],
          });
        }
      }
    }
    return result;
  }
}
