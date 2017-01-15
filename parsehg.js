//node --trace-hydrogen --trace-phase=Z --trace-deopt --hydrogen-track-positions --redirect-code-traces --redirect-code-traces-to=code.asm --trace_hydrogen_file=hg.cfg runner.js
var fs = require('fs');
var s = fs.readFileSync('hg.cfg', 'utf8');
var code = fs.readFileSync('code.asm', 'utf8');
var data = [];

class Map {
    get(k) {
        return this[k]
    }

    set(k, v) {
        return this[k] = v;
    }
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
                fnId = {parent: r[3], subId: r[4], name: r[2], inlines: []};
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
                    fnName = {deopt: false, versions: []};
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

var files = new Map();
parseCode(code, files);
parseIR(s, files);
// console.log(JSON.stringify(files, null, 2));

// console.log(JSON.stringify(files, null, 2));
// s.match(d);
// while (r = d.exec(s)) {
//     console.log(r[1]);
//     /*while (r2 = /LoadNamedGeneric (.*?) /g.exec(r[2])) {
//         console.log('  ' + r2[1]);
//     }*/
// }



function escape (string) {
    return string
        .replace(/>/g, '&gt;')
        .replace(/</g, '&lt;')
}

function makeHTML(files) {
    var html = `
<style>
body{font-family: Verdana; font-size: 12px;}
.file-item{}
.file-name{}
.file-name{}
.fn-names{}
.fn-item{margin: 10px;}
.fn-deopt{color: #ce1800;}
.fn-name{}
.fn-versions{}
.deopt{color: #ce1800; border-top: 1px solid silver;}
.code{border: 1px solid silver; padding: 5px; font-size: 12px; font-family: Consolas, Menlo, Courier, monospace;; white-space: pre;}
.runtime{background: lightgoldenrodyellow}
</style>
`;
    for (var fileName in files) {
        html += `<div class="file-item"><div class="file-name">${escape(fileName)}</div><div class="fn-names">`;
        var file = files[fileName];
        for (var fnName in file) {
            var fn = file[fnName];
            html += `<div class="fn-item ${fn.deopt ? 'fn-deopt' : ''}"><div class="fn-name">${escape(fnName)}:</div><div class="fn-versions">`;
            html += makeVersions(fn.versions);
            html += `</div></div>`;
        }
        html += `</div></div>`;
    }
    fs.writeFileSync('ir.html', html)
}

function makeVersions(versions) {
    var html = '';
     for (var i = 0; i < versions.length; i++) {
         var version = versions[i];
         if (i == versions.length - 1) {
             html += `<div class="code">${highlight(escape(version.code), version)}</div>`;
         }
         if (version.deopts.length) {
             var deopts = version.deopts;
             for (let j = 0; j < deopts.length; j++) {
                 var deopt = deopts[j];
                 html += `<div class="deopt">Deopt: ${escape(deopt)}</div>`;
             }
         }
     }

    return html;
}

function highlight(code, version) {
    var shift = 0;
    var prevEnd = -1;
    for (let i = 0; i < version.runtime.length; i++) {
        const runtime = version.runtime[i];
        var pos = +runtime.pos + shift;
        var end = findEnd(code, pos);
        if (prevEnd >= pos) {
            continue;
        }
        var oldCode = code.substring(pos, end);
        var replacedCode = `<span class="runtime" title="${runtime.text.replace(/"/g, '&quot;')}">${oldCode}</span>`;
        // var replacedCode = `"${oldCode}"`;
        code = code.substr(0, pos) + replacedCode + code.substr(end);
        shift += replacedCode.length - oldCode.length;
        prevEnd = end;
    }
    return code;
}

function findEnd(code, start) {
    new RegExp(`(.|\n){${start}}(\w+)`)
    var sub = code.substr(start, 100);
    var m = sub.match(/^[.=[ ]*[\w\d_]+/);
    if (m) {
        return start + m[0].length;
    }
    return start + 5;
}

makeHTML(files);