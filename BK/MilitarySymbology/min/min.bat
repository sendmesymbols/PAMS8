REM Components Folder

REM ..\Components\BaseLine.js
del ..\..\MilSym\Components\BaseLine.js
java -jar compiler.jar --compilation_level SIMPLE --externs init.js --externs ..\Extensions\GeoTools.js --externs ..\Components\Shapes.js --externs BaseLineExtern.js --js ..\Components\BaseLine.js --js_output_file ..\..\MilSym\Components\BaseLine.js  --warning_level QUIET


REM ..\Components\Echelons.js
del ..\..\MilSym\Components\Echelons.js
java -jar compiler.jar --compilation_level SIMPLE --externs init.js --externs ..\Extensions\GeoTools.js --externs EchelonsExtern.js --js ..\Components\Echelons.js --js_output_file ..\..\MilSym\Components\Echelons.js  --warning_level QUIET



REM ..\Components\Shapes.js
del ..\..\MilSym\Components\Shapes.js
java -jar compiler.jar --compilation_level SIMPLE --externs init.js --externs ..\Extensions\GeoTools.js --externs ..\Engines\SIDC.js --externs ShapesExtern.js --js ..\Components\Shapes.js --js_output_file ..\..\MilSym\Components\Shapes.js  --warning_level QUIET


REM Engines Folder

REM ..\Engines\Amplifier.js
del ..\..\MilSym\Engines\Amplifier.js
java -jar compiler.jar --compilation_level SIMPLE --externs init.js --externs ..\Extensions\GeoTools.js --externs ..\Components\BaseLine.js --externs AmplifierExtern.js --js ..\Engines\Amplifier.js --js_output_file ..\..\MilSym\Engines\Amplifier.js  --warning_level QUIET


REM ..\Engines\AnnotationEngine.js
del ..\..\MilSym\Engines\AnnotationEngine.js
java -jar compiler.jar --compilation_level SIMPLE --externs init.js --externs ..\Extensions\GeoTools.js --externs AnnotationEngineExtern.js --js ..\Engines\AnnotationEngine.js --js_output_file ..\..\MilSym\Engines\AnnotationEngine.js  --warning_level QUIET


REM ..\Engines\DrawEssentials.js
del ..\..\MilSym\Engines\DrawEssentials.js
java -jar compiler.jar --compilation_level SIMPLE --externs init.js --externs DrawEssentialsExtern.js --js ..\Engines\DrawEssentials.js --js_output_file ..\..\MilSym\Engines\DrawEssentials.js  --warning_level QUIET



REM ..\Engines\EditEngine.js
del ..\..\MilSym\Engines\EditEngine.js
java -jar compiler.jar --compilation_level SIMPLE --externs init.js --externs ..\Extensions\ControlPointsEditor.js --externs ..\Engines\AnnotationEngine.js --externs EditEngineExtern.js --js ..\Engines\EditEngine.js --js_output_file ..\..\MilSym\Engines\EditEngine.js  --warning_level QUIET

REM ..\Engines\MeasurementEngine.js
del ..\..\MilSym\Engines\MeasurementEngine.js
java -jar compiler.jar --compilation_level SIMPLE --externs init.js --js ..\Engines\MeasurementEngine.js --js_output_file ..\..\MilSym\Engines\MeasurementEngine.js  --warning_level QUIET


REM ..\Engines\Mapper.js
del ..\..\MilSym\Engines\Mapper.js
java -jar compiler.jar --compilation_level SIMPLE --externs init.js --externs MapperExtern.js --js ..\Engines\Mapper.js --js_output_file ..\..\MilSym\Engines\Mapper.js  --warning_level QUIET


REM ..\Engines\Mapper.js
del ..\..\MilSym\Engines\Mapper.js
java -jar compiler.jar --compilation_level SIMPLE --externs init.js --externs MapperExtern.js --js ..\Engines\Mapper.js --js_output_file ..\..\MilSym\Engines\Mapper.js  --warning_level QUIET


REM ..\Engines\SIDC.js
del ..\..\MilSym\Engines\SIDC.js
java -jar compiler.jar --compilation_level SIMPLE --externs init.js --externs SIDCExtern.js --js ..\Engines\SIDC.js --js_output_file ..\..\MilSym\Engines\SIDC.js  --warning_level QUIET



REM ..\Engines\SIDC.js
del ..\..\MilSym\Engines\SIDC.js
java -jar compiler.jar --compilation_level SIMPLE --externs init.js --externs SIDCExtern.js --js ..\Engines\SIDC.js --js_output_file ..\..\MilSym\Engines\SIDC.js  --warning_level QUIET

REM ..\Engines\SymbolEngine.js
del ..\..\MilSym\Engines\SymbolEngine.js
java -jar compiler.jar --compilation_level SIMPLE --externs init.js --externs ..\Engines\SIDC.js  --externs ..\Engines\Mapper.js --externs ..\Engines\AnnotationEngine.js --externs SymbolEngineExtern.js --js ..\Engines\SymbolEngine.js --js_output_file ..\..\MilSym\Engines\SymbolEngine.js  --warning_level QUIET







REM Extensions Extensions

REM ..\Extensions\ControlPointsEditor.js
del ..\..\MilSym\Extensions\ControlPointsEditor.js
java -jar compiler.jar --compilation_level SIMPLE --externs init.js --externs ControlPointsEditorExtern.js --js ..\Extensions\ControlPointsEditor.js --js_output_file ..\..\MilSym\Extensions\ControlPointsEditor.js  --warning_level QUIET


REM ..\Extensions\GeoTools.js
del ..\..\MilSym\Extensions\GeoTools.js
java -jar compiler.jar --compilation_level SIMPLE --externs init.js --externs GeoToolsExtern.js --js ..\Extensions\GeoTools.js --js_output_file ..\..\MilSym\Extensions\GeoTools.js  --warning_level QUIET


REM ..\Extensions\ExtentUtils.js
del ..\..\MilSym\Extensions\ExtentUtils.js
java -jar compiler.jar --compilation_level SIMPLE --externs init.js --externs GeoToolsExtern.js --js ..\Extensions\ExtentUtils.js --js_output_file ..\..\MilSym\Extensions\ExtentUtils.js  --warning_level QUIET




for %%i in (..\..\MilSym\Symbols\*.js) do (
del ..\..\MilSym\Symbols\%%~ni%.js
)


for %%i in (..\Symbols\*.js) do (
java -jar compiler.jar --compilation_level ADVANCED_OPTIMIZATIONS --externs init.js --externs ..\Components\Shapes.js --externs ..\Components\BaseLine.js --externs ..\Components\Echelons.js --externs ..\Extensions\GeoTools.js  --externs SymExtern.js --js %%i --js_output_file ..\..\MilSym\Symbols\%%~ni%.js  --warning_level QUIET
       
)

del ..\..\MilSym\Symbols\UEISymbol.js
java -jar compiler.jar --compilation_level ADVANCED_OPTIMIZATIONS --externs init.js --externs ..\Engines\DrawEssentials.js --externs ..\ThirdParty\milsymbol.js  --externs SymExtern.js --js ..\Symbols\UEISymbol.js --js_output_file ..\..\MilSym\Symbols\UEISymbol.js  --warning_level QUIET




REM DATA
for %%i in (..\..\MilSym\Data\*.json) do (
del ..\..\MilSym\Data\%%~ni%.json
)

for %%i in (..\Data\*.json) do (
copy %%i ..\..\MilSym\Data\%%~ni%.json
)



REM ThirdParty
for %%i in (..\..\MilSym\ThirdParty\*.js) do (
del ..\..\MilSym\ThirdParty\%%~ni%.js
)

for %%i in (..\ThirdParty\*.js) do (
copy %%i ..\..\MilSym\ThirdParty\%%~ni%.js
)

REM Delete both flare Files
del ..\..\MilSym\ThirdParty\Cluster.js
del ..\..\MilSym\ThirdParty\FlareClusterLayer_v4.js


REM Minify DataManager
java -jar compiler.jar --compilation_level SIMPLE --externs init.js --js ..\ThirdParty\DataManager.js --js_output_file ..\..\MilSym\ThirdParty\DataManager.js  --warning_level QUIET

REM Minify ClusterLayer
java -jar compiler.jar --compilation_level SIMPLE --externs init.js --externs clusterExtern.js --externs ..\ThirdParty\Cluster.js --externs ..\ThirdParty\DataManager.js --js ..\Extensions\ClusterLayer.js --js_output_file ..\..\MilSym\Extensions\ClusterLayer.js  --warning_level QUIET


REM Minify V3
java -jar compiler.jar --compilation_level SIMPLE --externs init.js --externs clusterExtern.js --externs ..\..\MilSym\Extensions\ClusterLayer.js --js ..\ThirdParty\Cluster.js --js_output_file ..\..\MilSym\ThirdParty\Cluster.js  --warning_level QUIET






REM Preview
for %%i in (..\..\MilSym\Preview\ControlMeasures\*.svg) do (
del ..\..\MilSym\Preview\ControlMeasures\%%~ni%.svg
)

for %%i in (..\Preview\ControlMeasures\*.svg) do (
copy %%i ..\..\MilSym\Preview\ControlMeasures\%%~ni%.svg
)




REM Images
for %%i in (..\..\MilSym\Images\*.png) do (
del ..\..\MilSym\Images\%%~ni%.png
)

for %%i in (..\Images\*.png) do (
copy %%i ..\..\MilSym\Images\%%~ni%.png
)


