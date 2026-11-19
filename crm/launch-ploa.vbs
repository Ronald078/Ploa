Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")

scriptFolder = fileSystem.GetParentFolderName(WScript.ScriptFullName)
projectFolder = fileSystem.GetParentFolderName(scriptFolder)

shell.CurrentDirectory = projectFolder
shell.Run "cmd.exe /d /s /c """"C:\Program Files\nodejs\npm.cmd"" run crm:app""", 0, False
