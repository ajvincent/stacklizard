"use strict";
class A {
  _() {
    this.x = this.c();
  }
  a() {
    console.log(this.b());
  }
  b() {
    void(this.c());
  }
  c() {
    return this.d() + 1;
  }
  d() {
    // just a comment
    let f = this.f();
    let e = this.e(f);
    return e + 1;
  }
  e(y) {
    return y + this.g() + 1;
  }
  f() {
    return 0;
  }
  g() {
    return 1;
  }
  async p() {
    return this.d();
  }
  async q() {
    return await this.d();
  }
}

const B = new A(); // eslint-disable-line no-unused-vars
