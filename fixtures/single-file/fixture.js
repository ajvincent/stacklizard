// Goal:  Determine where we have to make changes if A.prototype.e becomes asynchronous.

function A() {
  this.x = this.c;
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
  },

  p: async function() {
    return this.d();
  },

  q: async function() {
    return await this.d();
  },
};

const B = new A();
