# Slow-Code-Detector
Tool to show slow calls in your code runned by v8.

## Install
`npm i -g slow-code-detector`

## How to use

`scd your-index-js-file.js` – it creates bunch of files in current directory `code.asm` `hydrogen.cfg` `out.txt` `code.html`

`code.html` – is what you need, open it in the browser.

Also you can generate markdown file `code.md`, just run with `--md` option: `scd --md index.js`

Generated `code.html` groupped by files and functions.

## `code.html`
Every runtime call highlighted by gray. Call cost ~4ns.

Pink highlight is LoadGeneric or StoreGeneric. Generic read or write cost ~9ns.

If function in code is inlined it highlighted by blue, you can show its code by click.

If function is not inlined you can show `non inline reason` by a hint on call function name.

If function deoptimized, it colored by red.

Every function reoptimization marked by ~recompile~ – max 10 times, else deopt: `Optimize too many times`


## How it works
The `scd` execute `node` with some v8 trace options and parse given logs to find slow path calls.

`node --trace-inlining --trace-hydrogen --trace-phase=Z --trace-deopt`


## IRHydra
You can use `hydrogen.cfg` and `code.asm` with [IRHydra](http://mrale.ph/irhydra/2/#ir) to investigate internal representation of your code

