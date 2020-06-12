function a() {
  console.log(b());
}

function b() {
  void(c());
}

function c() {
  return d() + 1;
}

function d() {
  let F = f();
  let E = e(F);
  return E + 1;
}

function e(y) {
  return y + g() + 1;
}

function f() {
  return 0;
}

function g() {
  return 1;
}

async function p() {
  return d();
}

async function q() {
  return await d();
}

async function r() {
  return await q();
}
