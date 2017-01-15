var ExpressionNode = [1, 2, true, "abc", {}];
var IfNode = [2, 23, "", {}, true];
var IfElseNode = [3, 23, "", {}, true, {}, {}];
var ConditionNode = [4, 23, "", {}];
var VariableStatement = [5, 23, "", [], {}];
var VariableDeclaration = [6, 23, "", {}, null, null, []];
var Identifier = [7, 23, "", {}, [], null, 1];


function read(a) {
    switch (a[0]) {
        case 1: return 1;
        case 2: return 2;
        case 3: return 3;
        case 4: return 4;
        case 5: return 5;
        case 6: return 6;
        case 7: return 7;
    }
}

function abc() {
    console.time('perf');
    for (let i = 0; i < 1e6; i++) {
        read(ExpressionNode);
        read(IfNode);
        read(IfElseNode);
        read(ConditionNode);
        read(VariableStatement);
        read(VariableDeclaration);
        read(Identifier);
    }
    console.timeEnd('perf');
}
// abc();



function Node() {
    this.type = 1;
    this.value = 2;
    this.name = 'node';
}

var n0 = new Node();
n0.a0 = 1;
n0.b0 = {};
n0.c0 = 1;

var n1 = new Node();
n1.a1 = 1;
n1.b1 = {};
n1.c1 = 1;

var n2 = new Node();
n2.a2 = {};
n2.b2 = false;
n2.c2 = "qd";

var n3 = new Node();
n3.a3 = 12;
n3.b3 = false;
n3.c3 = {};

var n4 = new Node();
n4.a4 = 12;
n4.b4 = {};
n4.c4 = 5;


var n5 = new Node();
n5.a5 = 12;
n5.b5 = {};
n5.c5 = 5;


var n6 = new Node();
n6.a6 = 12;
n6.b6 = [];
n6.c6 = 5;

var n7 = new Node();
n7.a7 = 12;
n7.b7 = [];
n7.c7 = 5;


var n8 = new Node();
n8.a8 = [];
n8.b8 = {};
n8.c8 = 5;

var n9 = new Node();
n9.a9 = 12;
n9.b9 = {};
n9.c9 = 5;

function readType(node) {return node.type}

function read(node) {
    return readType(node) + readValue(node);
}


function readValue(node) {
    return readDeepValue(node);
}

function readDeepValue(node) {
    return node.value;
}


for (var i = 0; i < 500; i++) {
    read(n9);
    // readValue(n9)
}

read(n0);
read(n1);
read(n2);
read(n3);
read(n4);
read(n5);
// readType(n4);
// readType(n5);
// readType(n6);
// readType(n7);
// readType(n8);
// readType(n9);
// readValue(n0);


function abc2() {
    var x;
    console./*isIdentifier*/  time('perf');
    for (var i = 0; i < 1e8; i++) {
        x = read(n9);
    }
    /*isIdentifier*/  console.timeEnd('perf');
    return x;
}
abc2();
