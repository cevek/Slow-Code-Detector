var tickProcessorModule = require('tick/lib/tickprocessor');
var ArgumentsProcessor = tickProcessorModule.ArgumentsProcessor;
var TickProcessor = tickProcessorModule.TickProcessor;

function processArguments(args) {
    var processor = new ArgumentsProcessor(args);
    if (processor.parse()) {
        return processor.result();
    } else {
        processor.printUsageAndExit();
    }
}


var platform = process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'windows' : 'unix';
var entriesProvider = {
    'unix': tickProcessorModule.UnixCppEntriesProvider,
    'windows': tickProcessorModule.WindowsCppEntriesProvider,
    'mac': tickProcessorModule.MacCppEntriesProvider
}[platform];

var params = processArguments([]);
params.logFileName = 'v8.log';


exports.processTicks = function processTicks(v8log) {
    return new Promise((resolve) => {
        entriesProvider.prototype.loadSymbols = function () {
            this.symbols = '';
            this.parsePos = 0;
        };
        var snapshotLogProcessor;

        var tickProcessor = new TickProcessor(
            new (entriesProvider)(params.nm, params.targetRootFS),
            params.separateIc,
            params.callGraphSize,
            params.ignoreUnknown,
            params.stateFilter,
            snapshotLogProcessor,
            params.distortion,
            params.range,
            params.sourceMap);
        // tickProcessor.processLogFile(params.logFileName, tickProcessor.printStatistics.bind(tickProcessor));
        tickProcessor.processLogFile(v8log, function () {
            var _this = tickProcessor;
            var flatProfile = _this.profile_.getFlatProfile();
            var flatView = _this.viewBuilder_.buildView(flatProfile);
            var totalTicks = _this.ticks_.total;
            if (_this.ignoreUnknown_) {
                totalTicks -= _this.ticks_.unaccounted;
            }
            flatView.head.totalTime = totalTicks;
            var flatViewNodes = flatView.head.children;
            var self = _this;
            var libraryTicks = 0;
            _this.processProfile(flatViewNodes,
                function (name) {
                    return self.isSharedLibrary(name);
                },
                function (rec) {
                    libraryTicks += rec.selfTime;
                });

            var nonLibraryTicks = totalTicks - libraryTicks;

            var result = [];
            _this.processProfile(flatViewNodes, function (name) {
                return self.isJsCode(name);
            }, function (rec) {
                if (rec.selfTime == 0) return;
                var res = rec.internalFuncName.match(/LazyCompile: [*~]?(.*?) (.*?):(\d+):(\d+)/);
                if (res) {
                    result.push({filename: res[2], line: res[3], col: res[4], fnName: res[1], ticks: rec.selfTime});
                }
            });
            resolve({result, GCTicks: _this.ticks_.gc, totalTicks, nonLibraryTicks});

        });
    });
}

