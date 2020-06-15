# stacklizard
A static-analysis tool to simulate marking one function async, and determining what functions and function calls must change.

## A simplified scenario
Suppose you have the following code:
```javascript
// Goal:  Determine where we have to make changes if A.prototype.e becomes asynchronous.

function A() {
  this.x = this.d();
}
A.prototype = {
  a: function() {
    console.log(this.b());
  },

  b: function() {
    void(this.c);
  },

  get c() {
    return this.d() + 1;
  },

  d: function() {
    // just a comment
    let f = this.f();
    let e = this.e(f);
    return e + 1;
  },

  e: function(y) {
    return y + this.g() + 1;
  },

  f: function() {
    return 0;
  },

  g: function() {
    return 1;
  }
};

const B = new A();

```
In this scenario, `B.d() === 3`.  Everything's fine.  But for some reason, you need to mark `A.prototype.e` asynchronous:
```javascript
  e: async function(y) {
    return y + this.g() + 1;
  },
```

Evaluating B.d() results in `B.d() = [object Promise]1`.  That's not desirable.  To fix this, we'd have to make the caller await the promise.
```javascript
  d: function() {
    // just a comment
    let f = this.f();
    let e = await this.e(f);
    return e + 1;
  },
```

Except _that_ causes **SyntaxError: await is only valid in async functions and async generators**.  So then we mark d as async:
```javascript
  d: async function() {
    // just a comment
    let f = this.f();
    let e = await this.e(f);
    return e + 1;
  },
```
`B.d() = [object Promise]`

This we can await no problem... except that the constructor `A()` references `this.d()`.  We broke that as well, so we try to fix it:
```javascript
function A() {
  this.x = await this.d();
}
```
**SyntaxError: await is only valid in async functions and async generators**

Okay, mark the constructor async:
```javascript
async function A() {
  this.x = await this.d();
}
// ...
const B = new A();
```
**TypeError: A is not a constructor**

At this point you might throw your hands up in frustration (and rightly so).  But if you have to make that original function `e()` async, it might be helpful to know all the places you need to make changes.  StackLizard is for this purpose.

```
./stacklizard.js standalone docs/use-case/a/a.js 26
- e(), async a.js:26 FunctionExpression[0]
  - d(), await a.js:22 CallExpression[0], async a.js:19 FunctionExpression[0]
    - c(), await a.js:16 CallExpression[0], async a.js:15 FunctionExpression[0], accessor
      - b(), await a.js:12 MemberExpression[0], async a.js:11 FunctionExpression[0]
        - a(), await a.js:8 CallExpression[1], async a.js:7 FunctionExpression[0]
    - A(), await a.js:4 Identifier[1], async a.js:3 FunctionDeclaration[0], constructor
      - A(), await a.js:39 NewExpression[0]
- **SyntaxError**: async a.js:15 FunctionExpression[0], accessor
- **SyntaxError**: async a.js:3 FunctionDeclaration[0], constructor

```

Notably, StackLizard doesn't fix these problems for you, but it does point them out.
