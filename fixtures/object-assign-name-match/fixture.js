const A = {
  a: function() {
    return A.b();
  },

  b: function() {
    return 1;
  }
};
