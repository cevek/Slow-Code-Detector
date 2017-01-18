const childProc = require('child_process');
const fs = require('fs');
const command = process.argv.slice(2);

function parseFiles() {
    const s = fs.readFileSync('hg.cfg', 'utf8');
    const code = fs.readFileSync('code.asm', 'utf8');
    const files = new Map();
    parseCode(code, files);
    parseIR(s, files);
    makeHTML(files);
}

class SFile {
    fullname: string;
    funMap = new Map<string, Fun>();
    funIdMap = new Map<number, FunID>();
}

class Fun {
    name: string;
    deopt = false;
    versions: FunID[] = [];
    versionsIdMap = new Map<number, FunID>();
}


class Runtime {
    pos: number;
    type: string;
}

class FunID {
    id: number;
    secondId: number;
    ownerFunId: number;
    name: string;
    code: string;
    inlines: FunID[] = [];
    deopts: string[] = [];
    runtime: Runtime[] = [];
    inlinePos = 0;
    inlineFunSecondIdMap = new Map<number, FunID>();
}


type Files = Map<string, SFile>;


function parseIR(s: string, files: Files) {
    const fileIRBlocks = s.split(/^begin_compilation/m);
    for (let i = 0; i < fileIRBlocks.length; i++) {
        const IRBlock = fileIRBlocks[i];
        if (IRBlock) {
            const res = IRBlock.match(/^\s*name "(.*?):(.*?)"\s+method "(.*?):(\d+)"/);
            const fullname = res[1];
            const name = res[3];
            const id = +res[4];
            const file = files.get(fullname);
            if (!file) {
                throw new Error('No File: ' + fullname);
            }
            const fun = file.funMap.get(name);
            if (!fun) {
                throw new Error('No fun: ' + name);
            }
            const funID = fun.versionsIdMap.get(id);
            if (!funID) {
                throw new Error('No funId: ' + id);
            }
            const changesRegExp = /^\s+\d \d \w\d+ (\w+).*? changes\[\*\][^\n]* pos:(\d+)(?:_(\d+))? /mg;
            let changesRes;
            while (changesRes = changesRegExp.exec(IRBlock)) {
                const type = changesRes[1];
                const pos1 = +changesRes[2];
                const pos2 = +changesRes[3];
                if (pos2) {
                    const inlineFunID = funID.inlineFunSecondIdMap.get(pos1);
                    inlineFunID.runtime.push({pos: pos2, type: type});
                } else {
                    funID.runtime.push({pos: pos1, type: type});
                }
            }
        }
    }
}


function parseCode(s: string, files: Files) {
    const fns = s.split('--- FUNCTION SOURCE ');
    for (let i = 0; i < fns.length; i++) {
        const funBlock = fns[i];
        if (funBlock) {
            const fnRegExp = /^\s*\((.*?):(.*?)\) id\{(\d+),(\d+)\} ---\n([\s|\S]*)\n--- END ---/;
            const res = funBlock.match(fnRegExp);
            const filename = res[1];
            const name = res[2];
            const id = +res[3];
            const secondId = +res[4];
            const code = res[5];

            if (secondId !== 0) {
                const funId = new FunID();
                funId.code = code;
                funId.ownerFunId = id;
                funId.name = name;

                const file = files.get(filename);
                if (!file) {
                    throw new Error(`No file: ${filename}`);
                }
                const ownerFunId = file.funIdMap.get(id);
                if (!ownerFunId) {
                    throw new Error(`No ownerFunId: ${id}`);
                }
                ownerFunId.inlineFunSecondIdMap.set(secondId, funId);

                const inlineRes = funBlock.match(/INLINE \(.*?\) id\{\d+,\d+\} AS (\d+) AT <(\d+):(\d+)>/);
                if (inlineRes) {
                    const name = inlineRes[0];
                    const secondId = +inlineRes[1];
                    const parentSecondId = +inlineRes[2];
                    const inlinePos = +inlineRes[3];
                    funId.inlinePos = inlinePos;
                    const parentFunId = parentSecondId === 0 ? ownerFunId : ownerFunId.inlineFunSecondIdMap.get(parentSecondId);
                    if (!parentFunId) {
                        throw new Error('No parentFunId: ' + parentSecondId);
                    }
                    parentFunId.inlines.push(funId);
                }
                continue;
            }

            let file = files.get(filename);
            if (!file) {
                file = new SFile();
                file.fullname = filename;
                files.set(filename, file);
            }

            let fun = file.funMap.get(name);
            if (!fun) {
                fun = new Fun();
                fun.name = name;
                file.funMap.set(name, fun);
            }

            let funID = fun.versionsIdMap.get(id);
            if (!funID) {
                funID = new FunID();
            }

            fun.versions.push(funID);
            funID.name = name;
            funID.id = id;
            funID.code = code;
            file.funIdMap.set(id, funID);

            const deoptRegExp = /\[deoptimizing[^:]*: begin [^ ]* (.*?)\]/g;
            let deoptRes;
            while (deoptRes = deoptRegExp.exec(funBlock)) {
                funID.deopts.push(deoptRes[1]);
            }
            if (funID.deopts.length) {
                fun.deopt = true;
            }
        }
    }
}


function escape(str: string) {
    return str
        .replace(/>/g, '&gt;')
        .replace(/</g, '&lt;');
}

function makeHTML(files: Files) {
    let html = `<meta charset="UTF-8"><link rel="stylesheet" href="style.css"><script src="script.js"></script>`;
    for (const [, file] of files) {
        html += `<div class="file-item"><div class="file-name toggle-next">${escape(file.fullname)}</div><div class="fn-names">`;
        for (const [, fun] of file.funMap) {
            html += `<div class="fn-item ${fun.deopt ? 'fn-deopt' : ''}"><div class="fn-name toggle-next">${escape(fun.name)}:</div><div class="fn-versions">`;
            html += funHTML(fun);
            html += `</div></div>`;
        }
        html += `</div></div>`;
    }
    fs.writeFileSync('ir.html', html);
}

function funHTML(fun: Fun) {
    let html = '';
    const versions = fun.versions;
    for (let i = 0; i < versions.length; i++) {
        const version = versions[i];
        html += `<div class="recompile">`;
        if (versions.length > 1) {
            html += `<span class="recompile-title toggle-next">~recompile~</span>`;
        }
        html += `<div class="${versions.length - 1 === i ? '' : 'hidden'}">${funIDHTML(versions[versions.length - 1])}</div>`;
        const deopts = version.deopts;
        if (deopts.length) {
            for (let j = 0; j < deopts.length; j++) {
                const deopt = deopts[j];
                html += `<div class="deopt">Deopt: ${escape(deopt)}</div>`;
            }
        }
        html += `</div>`;
    }
    return html;
}

function funIDHTML(funID: FunID, hidden?: boolean):string {
    const replaces = [];
    const code = funID.code;

    for (let i = 0; i < code.length; i++) {
        if (code[i] === '<') replaces.push({start: i, end: i + 1, text: '&lt;'});
        else if (code[i] === '>') replaces.push({start: i, end: i + 1, text: '&gt;'});
    }

    for (let i = 0; i < funID.inlines.length; i++) {
        const inlineFunID = funID.inlines[i];
        const pos = inlineFunID.inlinePos;
        const end = findEnd(code, pos);
        const sub = code.substring(pos, end);
        const spaces = getSpaceSymbolsBeforePrevNewLineOfPos(code, end);
        replaces.push({
            start: pos,
            end: end,
            text: `<span class="inline toggle-next">${sub}</span><span class="inline-code hidden">${funIDHTML(inlineFunID)}${spaces}</span>`
        });
    }

    for (let i = 0; i < funID.runtime.length; i++) {
        const runtime = funID.runtime[i];
        const pos = runtime.pos;
        const end = findEnd(code, pos);
        const oldCode = (code.substring(pos, end));
        const prefix = '';//runtimeType[runtime.text] || '';
        const replacedCode = `<span class="runtime ${runtime.type}" data-title="${runtime.type}">${prefix}${oldCode}</span>`;
        replaces.push({start: pos, end: end, text: replacedCode});
    }
    return `<div class="code">${replaceCode(code, replaces)}</div>`;
}

function getSpaceSymbolsBeforePrevNewLineOfPos(code: string, pos: number) {
    let s = '';
    for (let i = pos - 1; i >= 0; i--) {
        if (code[i] === '\n') {
            return s;
        }
        s += ' ';
    }
    return s;
}

function sortStart(a: { start: number }, b: { start: number }) {
    return a.start < b.start ? -1 : 1;
}

interface Replace {
    start: number;
    end: number;
    text: string;
}

function replaceCode(code: string, replaces: Replace[]) {
    replaces.sort(sortStart);
    let shift = 0;
    let prevEnd = -1;
    for (let i = 0; i < replaces.length; i++) {
        const replace = replaces[i];
        const pos = replace.start + shift;
        const end = replace.end + shift;
        if (prevEnd > pos) {
            continue;
        }
        const replacedCode = replace.text;
        code = code.substr(0, pos) + replacedCode + code.substr(end);
        const diff = replacedCode.length - (end - pos);
        shift += diff;
        prevEnd = end + diff;
    }
    return code;
}

function findEnd(code: string, start: number) {
    new RegExp(`(.|\n){${start}}(\w+)`);
    const sub = code.substr(start, 100);
    const m = sub.match(/^(new |[.=[ !&<>\^%+\-|]*)?[\w\d_]+]?/);
    if (m) {
        return start + m[0].length;
    }
    return start + 5;
}

if (command.indexOf('--onlyparse') > -1) {
    parseFiles();
} else {
    childProc.exec('node --trace-hydrogen --trace-phase=Z --trace-deopt --hydrogen-track-positions --redirect-code-traces --redirect-code-traces-to=code.asm --trace_hydrogen_file=hg.cfg ' + command.join(' '), {
        maxBuffer: 10 * 1000 * 1000,
    }, (err: Buffer, stdout: Buffer, stderr: Buffer) => {
        if (err) {
            throw err;
        }
        console.log(stdout);
        console.log(stderr);
        parseFiles();
    });
}