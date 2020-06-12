const A = {};
A.a = function() {
  return A.b();
};

A.b = function() {
  return 1;
};
