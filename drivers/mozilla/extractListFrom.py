#!/usr/bin/env python3
import json
import sys
import ast

f = open(sys.argv[1])
contents = f.read() + "\n"
f.close()

def parseSubstrings(contents):
  items = []

  index = contents.find(sys.argv[2])
  while (index != -1):
    openBracket = contents.find("[", index)
    closeBracket = contents.find("]", openBracket)
    while True:
      if (closeBracket == -1):
        raise Exception("didn't find the right closing bracket")
      serialized = contents[openBracket:closeBracket + 1]
      print(serialized + "\n\n", file=sys.stderr)
      try:
        items += ast.literal_eval(serialized)
        break
      except:
        closeBracket = contents.find("]", closeBracket + 1)

    index = contents.find(sys.argv[1], closeBracket)

  json.dump(items, sys.stdout)
  print("")

def evaluateCode(contents):
  contents += "json.dump(" + sys.argv[2] + ", sys.stdout);\n"
  executable = compile(contents, sys.argv[1], 'exec')
  exec(executable)
  print("")

if (sys.argv[3] == "substrings"):
  parseSubstrings(contents)
elif (sys.argv[3] == "evaluate"):
  evaluateCode(contents)
else:
  raise Exception("Unknown mode: " + sys.argv[3])
