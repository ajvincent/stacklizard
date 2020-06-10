const A = {
  a: function() {
    return this.b();
  },

  b: function() {
    return 1;
  }
};
