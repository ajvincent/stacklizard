const A = {};
A.a = function() {
  return B.b();
};

A.b = function() {
  return 1;
};
