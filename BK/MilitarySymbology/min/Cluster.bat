
REM Minify DataManager
java -jar compiler.jar --compilation_level SIMPLE --externs init.js --js ..\ThirdParty\DataManager.js --js_output_file ..\..\MilSym\ThirdParty\DataManager.js  --warning_level QUIET

REM Minify ClusterLayer
java -jar compiler.jar --compilation_level SIMPLE --externs init.js --externs clusterExtern.js --externs ..\ThirdParty\Cluster.js --externs ..\ThirdParty\DataManager.js --js ..\Extensions\ClusterLayer.js --js_output_file ..\..\MilSym\Extensions\ClusterLayer.js  --warning_level QUIET


REM Minify V3
java -jar compiler.jar --compilation_level SIMPLE --externs init.js --externs clusterExtern.js --externs ..\..\MilSym\Extensions\ClusterLayer.js --js ..\ThirdParty\Cluster.js --js_output_file ..\..\MilSym\ThirdParty\Cluster.js  --warning_level QUIET


