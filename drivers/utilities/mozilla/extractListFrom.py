#!/usr/bin/env python3

# This is a quick & dirty attempt to convert lists written in Python to JSON-serialized lists.
# It is quite buggy, so be not surprised when it misses a lot.

# arguments:
# pathToFile:    The Python file to read.
# variableName:  The variable to extract from the Python file.
# extractMethod: The preferred method of parsing the Python file.

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
