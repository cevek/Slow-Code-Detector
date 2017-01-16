var childProc = require('child_process');
var fs = require('fs');
var command = process.argv.slice(2);

class Map {
    get(k) {
        return this[k]
    }

    set(k, v) {
        return this[k] = v;
    }
}


function parseFiles() {
    var s = fs.readFileSync('hg.cfg', 'utf8');
    var code = fs.readFileSync('code.asm', 'utf8');
    var files = new Map();
    parseCode(code, files);
    parseIR(s, files);
    makeHTML(files);
}


var fnIdSymbol = Symbol('fnId');
var subSymbol = Symbol('sub');
var versionsSymbol = Symbol('versionsSymbol');

function parseIR(s, files) {
    var r = s.split(/^begin_compilation/m);
    for (var i = 0; i < r.length; i++) {
        var fnIR = r[i];
        if (fnIR) {
            var fnPath = fnIR.match(/^\s*name "(.*?):(.*?)"/);
            var file = files.get(fnPath[1]);
            if (!file) {
                throw new Error('No File: ' + fnPath[1]);
            }
            var d = fnIR.match(/^  method "(.*?):(\d+)"/m);
            var fnName = file.get(d[1]);
            if (!fnName) {
                throw new Error('No fnName: ' + d[1]);
            }
            var fnId = fnName[versionsSymbol].get(d[2]);
            if (!fnId) {
                throw new Error('No fnId: ' + d[2]);
            }

            fnId.runtime = [];
            var r2;
            var dd = /^\s+\d \d \w\d+ (\w+).*? changes\[\*\][^\n]* pos:(\d+)(?:_(\d+))? /mg;
            while (r2 = dd.exec(fnIR)) {
                if (r2[3]) {
                    var sub = fnId[subSymbol].get(r2[2]);
                    if (!sub.runtime) {
                        sub.runtime = [];
                    }
                    sub.runtime.push({pos: r2[3], text: r2[1]})
                } else {
                    fnId.runtime.push({pos: r2[2], text: r2[1]})
                }
            }
        }
    }
}


function parseCode(code, files) {
    var fns = code.split('--- FUNCTION SOURCE ');
    for (var i = 0; i < fns.length; i++) {
        var fnIR = fns[i];
        if (fnIR) {
            var d = /^\s*\((.*?):(.*?)\) id\{(\d+),(\d+)\} ---\n([\s|\S]*)\n--- END ---/;
            var r = fnIR.match(d);

            if (r[4] !== '0') {
                fnId = {parent: r[3], subId: r[4], name: r[2], runtime: [], code: r[5], inlines: []};
                let superFnId = files.get(r[1])[fnIdSymbol].get(r[3]);
                let subMap = superFnId[subSymbol];
                subMap.set(r[4], fnId);

                var inline = fnIR.match(/INLINE \(.*?\) id\{\d+,\d+\} AS (\d+) AT <(\d+):(\d+)>/);
                if (inline) {
                    // console.log('  inline', r2[1], r2[2], r2[3], r2[4]);
                    fnId.pos = inline[3];
                    if (inline[2] == 0) {
                        superFnId.inlines.push(fnId);
                    } else {
                        subMap.get(inline[2]).inlines.push(fnId);
                    }
                }
                continue;
            } else {
                var file = files.get(r[1]);
                if (!file) {
                    file = new Map();
                    file[fnIdSymbol] = new Map();
                    files.set(r[1], file);
                    // throw new Error('No file: ' + r[1]);
                }
                var fnName = file.get(r[2]);
                if (!fnName) {
                    fnName = {name: r[2], deopt: false, versions: []};
                    fnName[versionsSymbol] = new Map();
                    file.set(r[2], fnName);
                    // throw new Error('No fnName: ' + r[2]);
                }
                var fnId = fnName[versionsSymbol].get(r[3]);
                if (!fnId) {
                    fnId = {};
                    fnName[versionsSymbol].set(r[3], fnId);
                    // throw new Error('No fnId: ' + r[3]);
                }
                fnName.versions.push(fnId);
            }
            fnId[subSymbol] = new Map();
            fnId.name = r[2];
            fnId.id = r[3];
            fnId.inlines = [];
            fnId.deopts = [];
            fnId.code = r[5];
            file[fnIdSymbol].set(r[3], fnId);

            var deopt = /\[deoptimizing[^:]*: begin [^ ]* (.*?)\]/g;
            var r2;
            while (r2 = deopt.exec(fnIR)) {
                // console.log('  deopt', r2[1]);
                fnId.deopts.push(r2[1])
            }
            if (fnId.deopts.length) {
                fnName.deopt = true;
            }
        }
    }

}


function escape(string) {
    return string
        .replace(/>/g, '&gt;')
        .replace(/</g, '&lt;')
}

function makeHTML(files) {
    var html = `<meta charset="UTF-8"><link rel="stylesheet" href="style.css"><script src="script.js"></script>`;
    for (var fileName in files) {
        html += `<div class="file-item"><div class="file-name toggle-next">${escape(fileName)}</div><div class="fn-names">`;
        var file = files[fileName];
        for (var fnName in file) {
            var fn = file[fnName];
            html += `<div class="fn-item ${fn.deopt ? 'fn-deopt' : ''}"><div class="fn-name toggle-next">${escape(fnName)}:</div><div class="fn-versions">`;
            html += makeVersions(fn);
            html += `</div></div>`;
        }
        html += `</div></div>`;
    }
    fs.writeFileSync('ir.html', html)
}

function makeVersions(fn) {
    var html = '';
    var versions = fn.versions;
    for (var i = 0; i < versions.length; i++) {
        var version = versions[i];
        html += `<div class="recompile">`;
        if (versions.length > 1) {
            html += `<span class="recompile-title toggle-next">~recompile~</span>`;
        }
        html += `<div class="${versions.length - 1 === i ? '' : 'hidden'}">${highlight(versions[versions.length - 1])}</div>`;
        var deopts = version.deopts;
        if (deopts.length) {
            for (let j = 0; j < deopts.length; j++) {
                var deopt = deopts[j];
                html += `<div class="deopt">Deopt: ${escape(deopt)}</div>`;
            }
        }
        html += `</div>`;
    }

    return html;
}

var runtimeType = {
    'LoadNamedGeneric': 'Ⓖ',
    'StoreNamedGeneric': 'Ⓖ',
    'LoadKeyedGeneric': 'Ⓖ',
    'StoreKeyedGeneric': 'Ⓖ',
    'CompareGeneric': 'Ⓖ'
};

function highlight(version, hidden) {
    var replaces = [];
    var code = version.code;

    for (var i = 0; i < code.length; i++) {
        if (code[i] === '<') replaces.push({start: i, end: i + 1, text: '&lt;'});
        else if (code[i] === '>') replaces.push({start: i, end: i + 1, text: '&gt;'});
    }

    for (var i = 0; i < version.inlines.length; i++) {
        var inlineFn = version.inlines[i];
        var pos = +inlineFn.pos;
        var end = findEnd(code, pos);
        var sub = code.substring(pos, end);
        var spaces = getSpaceSymbolsBeforePrevNewLineOfPos(code, end);
        replaces.push({
            start: pos,
            end: end,
            text: `<span class="inline toggle-next">${sub}</span><span class="inline-code hidden">${highlight(inlineFn)}${spaces}</span>`
        });
    }

    for (var i = 0; i < version.runtime.length; i++) {
        var runtime = version.runtime[i];
        var pos = +runtime.pos;
        var end = findEnd(code, pos);
        var oldCode = (code.substring(pos, end));
        var prefix = ''//runtimeType[runtime.text] || '';
        var replacedCode = `<span class="runtime ${runtime.text}" data-title="${runtime.text}">${prefix}${oldCode}</span>`;
        replaces.push({start: pos, end: end, text: replacedCode})
    }
    return `<div class="code">${replaceCode(code, replaces)}</div>`;
}

function getSpaceSymbolsBeforePrevNewLineOfPos(code, pos) {
    var s = '';
    for (var i = pos - 1; i >= 0; i--) {
        if (code[i] === '\n') {
            return s;
        }
        s += ' ';
    }
}

function sortStart(a, b) {
    return a.start < b.start ? -1 : 1;
}
function replaceCode(code, replaces) {
    replaces.sort(sortStart);
    var shift = 0;
    var prevEnd = -1;
    for (var i = 0; i < replaces.length; i++) {
        var replace = replaces[i];
        var pos = replace.start + shift;
        var end = replace.end + shift;
        if (prevEnd > pos) {
            continue;
        }
        var replacedCode = replace.text;
        code = code.substr(0, pos) + replacedCode + code.substr(end);
        var diff = replacedCode.length - (end - pos);
        shift += diff;
        prevEnd = end + diff;
    }
    return code;
}

function findEnd(code, start) {
    new RegExp(`(.|\n){${start}}(\w+)`)
    var sub = code.substr(start, 100);
    var m = sub.match(/^(new |[.=[ !&<>\^%+\-|]*)?[\w\d_]+]?/);
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
    }, (err, stdout, stderr) => {
        if (err) {
            throw err;
        }
        console.log(stdout);
        console.log(stderr);
        parseFiles();
    });
}