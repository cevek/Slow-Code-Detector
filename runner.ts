import * as ts from 'typescript';
import {existsSync} from 'fs';
import {readFileSync} from 'fs';
const fileNames = ['index.ts'];
const basePath: string = process.cwd();
const settings = ts.convertCompilerOptionsFromJson('{}', basePath);
const servicesHost: ts.LanguageServiceHost = {
    getScriptFileNames: () => fileNames,
    getScriptVersion: (fileName) => files[fileName] && files[fileName].version.toString(),
    getScriptSnapshot: (fileName) => {
        if (!existsSync(fileName)) {
            return undefined;
        }

        return ts.ScriptSnapshot.fromString(readFileSync(fileName).toString());
    },
    getCurrentDirectory: () => process.cwd(),
    getCompilationSettings: () =>  ({ module: ts.ModuleKind.CommonJS }),
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
};

const services = ts.createLanguageService(servicesHost, ts.createDocumentRegistry());
const program = ts.createProgram(fileNames, settings.options);
let diagnostics = program.getSyntacticDiagnostics();
const emitOutput = program.emit();
const files = program.getSourceFiles();

debugger;
