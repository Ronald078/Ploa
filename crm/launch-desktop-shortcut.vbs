Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")
projectFolder = fileSystem.GetParentFolderName(fileSystem.GetParentFolderName(WScript.ScriptFullName))
userFolder = shell.ExpandEnvironmentStrings("%USERPROFILE%")
Set processEnvironment = shell.Environment("PROCESS")
processEnvironment("PATH") = userFolder & "\Documents\Codex\Ferramentas\node-v24.18.0-win-x64;" & userFolder & "\.cache\codex-runtimes\codex-primary-runtime\dependencies\python;" & processEnvironment("PATH")
processEnvironment("PYTHONPATH") = projectFolder & "\.python-deps"
processEnvironment("PUPPETEER_EXECUTABLE_PATH") = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
shell.CurrentDirectory = projectFolder
shell.Run Chr(34) & projectFolder & "\node_modules\electron\dist\electron.exe" & Chr(34) & " crm/desktop-accounts.js", 0, False
