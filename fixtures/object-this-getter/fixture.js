const A = {
  a: function() {
    return this.b;
  },

  get b() {
    return this.c();
  },

  c: function() {
  }
};
