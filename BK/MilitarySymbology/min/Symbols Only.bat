for %%i in (..\..\MilSym\Symbols\*.js) do (
del ..\..\MilSym\Symbols\%%~ni%.js
)


for %%i in (..\Symbols\*.js) do (
java -jar compiler.jar --compilation_level ADVANCED_OPTIMIZATIONS --externs init.js --externs ..\Components\Shapes.js --externs ..\Components\BaseLine.js --externs ..\Components\Echelons.js --externs ..\Extensions\GeoTools.js  --externs SymExtern.js --js %%i --js_output_file ..\..\MilSym\Symbols\%%~ni%.js  --warning_level QUIET
       
)


del ..\..\MilSym\Symbols\UEISymbol.js
java -jar compiler.jar --compilation_level ADVANCED_OPTIMIZATIONS --externs init.js --externs ..\Engines\DrawEssentials.js --externs ..\ThirdParty\milsymbol.js  --externs SymExtern.js --js ..\Symbols\UEISymbol.js --js_output_file ..\..\MilSym\Symbols\UEISymbol.js  --warning_level QUIET