using UnrealBuildTool;
using System.Collections.Generic;

public class ImpastoEditorTarget : TargetRules
{
	public ImpastoEditorTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Editor;
		DefaultBuildSettings = BuildSettingsVersion.Latest;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.Add("Impasto");
		ExtraModuleNames.Add("ImpastoEditor");
	}
}
