const A = {};
A.a = function() {
  return this.b();
};

A.b = function() {
  return 1;
};
