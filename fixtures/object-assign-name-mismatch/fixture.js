const A = {
  a: function() {
    return B.b();
  },

  b: function() {
    return 1;
  }
};
