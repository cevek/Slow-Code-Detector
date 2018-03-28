import { execSync } from 'child_process';
const childProc = require('child_process');
const fs = require('fs');
const command = process.argv.slice(2);
const path = require('path');
// const processTicks = require('./profiler/prof').processTicks;
var esprima = require('esprima');

namespace spd {
    interface Prof {
        totalTicks: number;
        GCTicks: number;
        nonLibraryTicks: number;
        result: {
            filename: string;
            line: number;
            col: number;
            fnName: string;
            ticks: number;
        }[];
    }

    class File {
        fullname: string;
        funMap = new Map<string, Fun>();
    }

    class Fun {
        name: string;
        deopt = false;
        versions: FunID[] = [];
        versionsIdMap = new Map<number, FunID>();
        didNotInlineReason = '';
        ticks = 0;

        get lastVersion() {
            return this.versions[this.versions.length - 1];
        }
    }

    class FunID {
        id: number;
        file: File;
        secondId: number;
        ownerFunId: number;
        name: string;
        code: string;
        codeTokensRange: [number, number][] = [];
        fun: Fun;
        inlines: FunID[] = [];
        deopts: string[] = [];
        runtime: Runtime[] = [];
        start = 0;
        inlinePos = 0;
        inlineFunSecondIdMap = new Map<number, FunID>();
        futureDeoptPos: number[] = [];
    }

    class Runtime {
        pos: number;
        type: string;
    }

    interface Replace {
        start: number;
        end: number;
        text: string;
    }

    class Program {
        GCTicks = 0;
        files = new Map<string, File>();
        funMap = new Map<string, Fun>();
        funIdMap = new Map<number, FunID>();
        isMarkdown = false;
        cwd = process.cwd() + '/';
        cfg = this.cwd + 'turbo.cfg';
        codeAsm = this.cwd + 'code.asm';
        outTxt = this.cwd + 'out.txt';
        codeHtml = this.cwd + 'code.html';
        codeMD = this.cwd + 'code.md';
        v8Log = this.cwd + 'v8.log';

        run() {
            let pos: number;
            if ((pos = command.indexOf('--md')) > -1) {
                this.isMarkdown = true;
                command.splice(pos, 1);
            }
            if ((pos = command.indexOf('--onlyparse')) > -1) {
                command.splice(pos, 1);
                program.parseFiles();
                this.make();
            } else {
                const file = command[0];
                if (!file) {
                    console.error('No input file specified');
                    return;
                }
                this.cleanUp();
                const com = [
                    '--trace-turbo-inlining',
                    '--prof',
                    '--cpu_profiler_sampling_interval=500',
                    '--logfile=v8.log',
                    '--no-logfile_per_isolate',
                    `--trace_turbo_cfg_file=${this.cfg}`,
                    '--trace-turbo',
                    '--redirect-code-traces',
                    '--print_opt_source',
                    `--redirect-code-traces-to=${this.codeAsm}`,
                    '--trace-deopt',
                    ...command,
                ];
                console.log('node ' + com.join(' '));
                const proc = childProc.spawn('node', com);
                let out = '';
                proc.stdout.pipe(process.stdout);
                proc.stderr.pipe(process.stderr);
                proc.stdout.on('data', (data: Buffer) => {
                    out += data.toString();
                });

                proc.on('error', (err: any) => {
                    throw err;
                });

                proc.on('close', () => {
                    try {
                        fs.accessSync(this.cfg);
                        fs.accessSync(this.codeAsm);
                        fs.accessSync(this.v8Log);
                    } catch (e) {
                        console.log('Optimized functions are not found');
                        return;
                    }
                    fs.writeFileSync(this.outTxt, out);
                    program.parseFiles();
                    // processTicks(this.v8Log).then((data: Prof) => {
                    //     this.applyProf(data);
                    //     this.make();
                    // });
                    this.cleanUp();
                    this.make();
                });
            }
        }

        cleanUp() {
            try {
                fs.unlinkSync(this.codeMD);
            } catch (e) {}
            try {
                fs.unlinkSync(this.codeHtml);
            } catch (e) {}
            try {
                fs.unlinkSync(this.outTxt);
            } catch (e) {}
            try {
                fs.unlinkSync(this.codeAsm);
            } catch (e) {}
            try {
                fs.unlinkSync(this.cfg);
            } catch (e) {}
            try {
                fs.unlinkSync(this.v8Log);
            } catch (e) {}
            execSync('rm -rf ' + this.cwd + 'turbo-*');
        }

        applyProf(prof: Prof) {
            for (let i = 0; i < prof.result.length; i++) {
                const res = prof.result[i];
                const file = this.files.get(res.filename);
                if (!file) {
                    console.error('Prof: no file ' + res.filename);
                    continue;
                }
                const fun = file.funMap.get(res.fnName);
                if (!fun) {
                    console.error('Prof: no fun: ' + res.fnName);
                    continue;
                }
                fun.ticks = Math.max(fun.ticks, res.ticks);
            }
            this.GCTicks = prof.GCTicks;
        }

        parseFiles() {
            let s: string;
            let code: string;
            let out: string;
            try {
                s = fs.readFileSync(this.cfg, 'utf8');
                code = fs.readFileSync(this.codeAsm, 'utf8');
                out = fs.readFileSync(this.outTxt, 'utf8');
            } catch (e) {
                console.error(e.message);
                return;
            }
            this.parseCode(code);
            this.parseIR(s);
            this.parseDidNotInlineReasons(out);
        }

        parseIR(s: string) {
            // console.log('@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@ parseIR');
            const fileIRFns = s.split(/^begin_compilation/m);
            for (let i = 0; i < fileIRFns.length; i++) {
                const IRBlock = fileIRFns[i];
                if (IRBlock) {
                    const res = IRBlock.match(/^\s*name "(.*?)"\s+method "(.*?):(\d+)"/);
                    // const fullname = res[1];
                    const name = res[2];
                    const id = +res[3];
                    // const file = this.files.get(fullname);
                    // if (!file) {
                    //     throw new Error('No File: ' + fullname);
                    // }
                    const funId = this.funIdMap.get(id);
                    if (!funId) {
                        throw new Error('No fun: ' + name);
                    }
                    const fun = funId.fun;
                    const funID = fun.versionsIdMap.get(id);
                    if (!funID) {
                        throw new Error('No funID: ' + id);
                    }
                    //      0 2 n117 Call[Code:StoreWithVector Descriptor:r1s0i7f1t0]   n221 n8 n217 n290 n220 n218 n102 n118 Eff: n287 Ctrl: n287  pos:inlining(1),104 <|@
                    const changesRegExp = /^\s+\d \d \w\d+ Call\[Code:(.*?)[: ][^\n]* pos:(?:inlining\((\d+)\),)?(\d+)/gm;
                    let changesRes;
                    while ((changesRes = changesRegExp.exec(IRBlock))) {
                        // console.log(changesRes[1], changesRes[2]);
                        const type = changesRes[1];
                        if (type === 'StackGuard') continue;
                        const pos1 = changesRes[2] === undefined ? undefined : +changesRes[2];
                        const pos2 = +changesRes[3];
                        if (pos1 !== undefined) {
                            const inlineFunID = funID.inlineFunSecondIdMap.get(pos1);
                            inlineFunID.runtime.push({ pos: pos2, type: type });
                        } else {
                            funID.runtime.push({ pos: pos2, type: type });
                        }
                    }

                    const deoptBlockRegExp = /(?:BlockEntry  type:Tagged pos:(\d+) <\|@\s+)?\d+ \d+ [\d\w]+ Deoptimize .*? pos:(\d+) /g;
                    let deoptBlockRes;
                    while ((deoptBlockRes = deoptBlockRegExp.exec(IRBlock))) {
                        const blockPos = deoptBlockRes[1];
                        const deoptPos = blockPos ? +blockPos : +deoptBlockRes[2];
                        funID.futureDeoptPos.push(deoptPos);
                    }
                }
            }
        }

        parseCode(s: string) {
            // console.log('@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@ parseCode');
            const fns = s.split('--- FUNCTION SOURCE ');
            // const fns = s.split('--- FUNCTION SOURCE ');
            for (let i = 0; i < fns.length; i++) {
                const funBlock = fns[i];
                if (funBlock) {
                    const fnRegExp = /\((.*?):(.*?)\) id\{(\d+),(-?\d+)\} start{(\d+)} ---\n([\s|\S]*)\n--- END ---/;
                    const res = funBlock.match(fnRegExp);
                    if (!res) continue;
                    // console.log('***************', res);
                    const filename = res[1];
                    const name = res[2];
                    const id = +res[3];
                    const secondId = +res[4];
                    const start = +res[5];
                    const code = res[6];

                    let file = this.files.get(filename);
                    if (!file) {
                        file = new File();
                        file.fullname = filename;
                        this.files.set(filename, file);
                    }

                    const tokens = esprima
                        .tokenize('function' + code, { range: true })
                        .map((token: any) => [token.range[0] - 8, token.range[1] - 8]);
                    if (secondId !== -1) {
                        const funID = new FunID();
                        funID.code = code;
                        funID.ownerFunId = id;
                        funID.name = name;
                        funID.start = start;
                        funID.codeTokensRange = tokens;

                        const file = this.files.get(filename);
                        if (!file) {
                            throw new Error(`No file: ${filename}`);
                        }
                        const ownerFunId = this.funIdMap.get(id);
                        if (!ownerFunId) {
                            throw new Error(`No ownerFunId: ${id}`);
                        }
                        ownerFunId.inlineFunSecondIdMap.set(secondId, funID);
                        funID.file = ownerFunId.file;

                        const inlineRes = funBlock.match(/INLINE \(.*?\) id{\d+,-?\d+} AS (\d+) AT <(-?\d+):(\d+)>/);
                        if (inlineRes) {
                            const name = inlineRes[0];
                            const secondId = +inlineRes[1];
                            const parentSecondId = +inlineRes[2];
                            const inlinePos = +inlineRes[3];
                            funID.inlinePos = inlinePos;
                            const parentFunId =
                                parentSecondId === -1
                                    ? ownerFunId
                                    : ownerFunId.inlineFunSecondIdMap.get(parentSecondId);
                            if (!parentFunId) {
                                throw new Error('No parentFunId: ' + parentSecondId);
                            }
                            parentFunId.inlines.push(funID);
                        }
                        continue;
                    }

                    let fun = file.funMap.get(name);
                    if (!fun) {
                        fun = new Fun();
                        fun.name = name;
                        file.funMap.set(name, fun);
                        this.funMap.set(name, fun);
                    }

                    let funID = fun.versionsIdMap.get(id);
                    if (!funID) {
                        funID = new FunID();
                        fun.versionsIdMap.set(id, funID);
                    }

                    fun.versions.push(funID);
                    funID.file = file;
                    funID.name = name;
                    funID.id = id;
                    funID.code = code;
                    funID.fun = fun;
                    funID.start = start;
                    funID.codeTokensRange = tokens;
                    this.funIdMap.set(id, funID);

                    const deoptRegExp = /\[deoptimizing[^:]*: begin [^ ]* (.*?)\]/g;
                    let deoptRes;
                    while ((deoptRes = deoptRegExp.exec(funBlock))) {
                        funID.deopts.push(deoptRes[1]);
                    }
                    if (funID.deopts.length) {
                        fun.deopt = true;
                    }
                }
            }
        }

        parseDidNotInlineReasons(s: string) {
            const regexp = /Did not inline (.*?) called from (.*?) \((.*?)\)\./g;
            //(cumulative AST node limit reached)
            //(target text too big)
            //(target AST is too large [early])
            //(inline depth limit reached)
            //(target has context-allocated variables)
            //(target not inlineable).
            //(target is recursive).
            let res;
            while ((res = regexp.exec(s))) {
                const name = res[1];
                const calledFrom = res[2];
                const reason = res[3];
                // skip env condition reasons
                if (/(cumulative|depth limit|recursive)/.test(reason)) {
                    continue;
                }
                const fun = this.funMap.get(name);
                if (fun) {
                    fun.didNotInlineReason = reason;
                }
            }
        }

        escape(str: string) {
            return str.replace(/>/g, '&gt;').replace(/</g, '&lt;');
        }

        make() {
            if (this.isMarkdown) {
                this.makeMD();
            } else {
                this.makeHTML();
            }
        }

        makeHTML() {
            const css = fs.readFileSync(__dirname + '/style.css', 'utf8');
            const script = fs.readFileSync(__dirname + '/script.js', 'utf8');
            let html = `<meta charset="UTF-8"><style>${css}</style><script>${script}</script></script>`;
            // html += `<div class="file-item"><div class="file-name toggle-next">GC (${this.GCTicks} ticks)</div></div>`;

            for (const [, file] of this.files) {
                html += `<div class="file-item"><div class="file-name toggle-next">${this.escape(
                    file.fullname
                )}</div><div class="fn-names">`;
                const funs = [...file.funMap.values()];
                funs.sort((a, b) => (a.ticks > b.ticks ? -1 : 1));
                for (let i = 0; i < funs.length; i++) {
                    const fun = funs[i];
                    html += this.funHTML(fun);
                }
                html += `</div></div>`;
            }
            fs.writeFileSync(this.codeHtml, html);
            console.log('Created ' + path.relative(this.cwd, this.codeHtml));
        }

        makeMD() {
            let out = `## GC (${this.GCTicks} ticks)\n\n`;
            for (const [, file] of this.files) {
                out += `\n## ${file.fullname}:\n`;
                for (const [, fun] of file.funMap) {
                    out += this.funHTML(fun);
                }
            }
            fs.writeFileSync(this.codeMD, out);
            console.log('Created ' + path.relative(this.cwd, this.codeMD));
        }

        funHTML(fun: Fun) {
            let out = '';
            if (this.isMarkdown) {
                if (fun.deopt) {
                    out += `\n### ⛔ ${fun.name} (${fun.ticks} ticks) (deoptimizated):\n`;
                } else {
                    out += `\n### ${fun.name} (${fun.ticks} ticks):\n`;
                }
            } else {
                out += `<div class="fn-item ${fun.deopt ? 'fn-deopt' : ''}"><a class="fn-name" href="#${this.escape(
                    fun.name
                )}" id="${this.escape(fun.name)}">${this.escape(fun.name)}:</a><div class="fn-versions">`;
            }
            const versions = fun.versions;
            for (let i = 0; i < versions.length; i++) {
                const version = versions[i];
                if (!this.isMarkdown) {
                    out += `<div class="recompile">`;
                }
                if (versions.length > 1) {
                    if (!this.isMarkdown) {
                        out += `<span class="recompile-title toggle-next">~recompile~</span>`;
                    } else {
                        out += `<div>~recompile~</div>\n`;
                    }
                }
                if (i + 1 === versions.length) {
                    if (this.isMarkdown) {
                        out += this.funIDHTML(versions[versions.length - 1], true);
                    } else {
                        out += `<div class="${versions.length - 1 === i ? '' : 'hidden'}">${this.funIDHTML(
                            versions[versions.length - 1],
                            true
                        )}</div>\n`;
                    }
                }
                const deopts = version.deopts;
                if (deopts.length) {
                    for (let j = 0; j < deopts.length; j++) {
                        const deopt = deopts[j];
                        if (this.isMarkdown) {
                            out += `\n\`\`\`diff\n- Deopt: ${deopt}\n\`\`\`\n`;
                        } else {
                            out += `<div class="deopt">Deopt: ${this.escape(deopt)}</div>`;
                        }
                    }
                }
                if (!this.isMarkdown) {
                    out += `</div>\n`;
                } else {
                    out += `\n`;
                }
            }
            if (this.isMarkdown) {
                out += '\n';
            } else {
                out += `</div></div>`;
            }
            return out;
        }

        funIDHTML(funID: FunID, isTopLevel: boolean): string {
            const replaces = [];
            const code = funID.code;

            for (let i = 0; i < code.length; i++) {
                if (code[i] === '<') replaces.push({ start: i, end: i + 1, text: '&lt;' });
                else if (code[i] === '>') replaces.push({ start: i, end: i + 1, text: '&gt;' });
            }

            const inlinedFunCode: string[] = [];

            for (let i = 0; i < funID.inlines.length; i++) {
                const inlineFunID = funID.inlines[i];
                const pos = inlineFunID.inlinePos - funID.start;
                const end = findEndRange(pos, funID.codeTokensRange);
                const sub = code.substring(pos, end);
                const spaces = this.getSpaceSymbolsBeforePrevNewLineOfPos(code, end);
                let text = `<span class="inline toggle-next" data-title="Show inlined">${sub}</span><span class="inline-code hidden">${this.funIDHTML(
                    inlineFunID,
                    false
                )}${spaces}</span>`;
                if (this.isMarkdown) {
                    inlinedFunCode.push(
                        `<details>\n<summary>${sub}</summary>\n${this.funIDHTML(inlineFunID, false)}\n</details>`
                    );
                    text = `<b title="Inlined">🔷${sub}</b>`;
                }
                replaces.push({
                    start: pos,
                    end: end,
                    text: text,
                });
            }

            for (let i = 0; i < funID.futureDeoptPos.length; i++) {
                const pos = funID.futureDeoptPos[i];
                const end = findEndRange(pos, funID.codeTokensRange);
                const sub = code.substring(pos, end);
                let text = `<span class="future-deopt" data-title="Future Deopt">${sub}</span>`;
                if (this.isMarkdown) {
                    text = `<b title="Future Deopt">🔴${sub}</b>`;
                }
                replaces.push({
                    start: pos,
                    end: end,
                    text: text,
                });
            }

            for (let i = 0; i < funID.runtime.length; i++) {
                const runtime = funID.runtime[i];
                const pos = runtime.pos - funID.start;
                // console.log(runtime.pos, funID.start);
                const end = findEndRange(pos, funID.codeTokensRange);
                let oldCode = code.substring(pos, end);
                const prefix = ''; //runtimeType[runtime.text] || '';
                const type =
                    runtime.type === 'InvokeFunction' || runtime.type === 'CallRuntime'
                        ? 'CallWithDescriptor'
                        : runtime.type;
                let replacedCode = `<span class="runtime ${type}" data-title="${type}">${prefix}${oldCode}</span>`;
                if (this.isMarkdown) {
                    replacedCode =
                        (type === 'CallWithDescriptor' ? '🔶' : '⚠') + `️<i><b title="${type}">${oldCode}</b></i>`;
                }
                if (type === 'CallWithDescriptor') {
                    const linkedFun = this.funMap.get(oldCode);
                    if (linkedFun) {
                        replacedCode = `<a class="runtime ${type}" ${
                            linkedFun.didNotInlineReason
                                ? `did-not-inlined data-title="Did not inline: ${linkedFun.didNotInlineReason}"`
                                : ''
                        } href="#${oldCode}">${oldCode}</a>`;
                        if (this.isMarkdown) {
                            replacedCode = `🔶<i><b title="Did not inline: ${linkedFun.didNotInlineReason ||
                                'unknown'}">${oldCode}</b></i>`;
                        }
                    }
                }

                replaces.push({ start: pos, end: end, text: replacedCode });
            }

            let out = `<pre class="code">\n${this.replaceCode(code, replaces)}</pre>\n`;
            if (this.isMarkdown && inlinedFunCode.length) {
                out += '<blockquote>\n';
                out += 'Inlined functions: \n';
                for (let i = 0; i < inlinedFunCode.length; i++) {
                    const funCode = inlinedFunCode[i];
                    out += funCode + '\n';
                }
                out += '</blockquote>\n';
            }
            return out;
        }

        getSpaceSymbolsBeforePrevNewLineOfPos(code: string, pos: number) {
            let s = '';
            for (let i = pos - 1; i >= 0; i--) {
                if (code[i] === '\n') {
                    return s;
                }
                s += ' ';
            }
            return s;
        }

        sortStart(a: { start: number }, b: { start: number }) {
            return a.start < b.start ? -1 : 1;
        }

        replaceCode(code: string, replaces: Replace[]) {
            replaces.sort(this.sortStart);
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
        //
        // findEnd(code: string, start: number) {
        //     new RegExp(`(.|\n){${start}}(\w+)`);
        //     const sub = code.substr(start, 100);
        //     const m = sub.match(/^(new |[.=[ !&<>\^%+\-|]*)?[\w\d_]+]?/);
        //     if (m) {
        //         return start + m[0].length;
        //     }
        //     return start + 5;
        // }
    }

    const program = new Program();
    program.run();
}

function findEndRange(from: number, ranges: [number, number][]) {
    from += 1;
    for (let i = 0; i < ranges.length; i++) {
        const [start, end] = ranges[i];
        if (end < from) continue;
        if (start <= from) {
            return end;
        }
    }
    return undefined;
}
