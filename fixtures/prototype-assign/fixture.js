// Goal:  Determine where we have to make changes if A.prototype.e becomes asynchronous.
"use strict";
function A() {
  this.x = this.c();
}
A.prototype.a = function() {
  console.log(this.b());
};

A.prototype.b = function() {
  void(this.c());
};

A.prototype.c = function() {
  return this.d() + 1;
};

A.prototype.d = function() {
  // just a comment
  let f = this.f();
  let e = this.e(f);
  return e + 1;
};

A.prototype.e = function(y) {
  return y + this.g() + 1;
};

A.prototype.f = function() {
  return 0;
};

A.prototype.g = function() {
  return 1;
};

A.prototype.p = async function() {
  return this.d();
};

A.prototype.q = async function() {
  return await this.d();
};

const B = new A(); // eslint-disable-line no-unused-vars
