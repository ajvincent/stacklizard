XPCOMUtils.defineLazyServiceGetter(
  this, "M", "@mozilla.org/dummy/a;1", "nsITestA"
);

const z = M.c;
