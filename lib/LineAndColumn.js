function LineAndColumn(other = null) {
  other ? this.copy(other) : this.clear();
}

LineAndColumn.prototype.copy = function(other) {
  this.line = other.line;
  this.column = other.column;
  this.url = other.url;
};
LineAndColumn.prototype.clear = function() {
  this.line = 0;
  this.column = 0;
  this.url = "";
};
Reflect.defineProperty(LineAndColumn.prototype, "isCleared", {
  get: function() { return (this.line === 0); },
  enumerable: true,
  configurable: false,
});

module.exports = LineAndColumn;
