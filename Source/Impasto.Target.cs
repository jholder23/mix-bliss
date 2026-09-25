using UnrealBuildTool;
using System.Collections.Generic;

public class ImpastoTarget : TargetRules
{
	public ImpastoTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Game;
		DefaultBuildSettings = BuildSettingsVersion.Latest;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.Add("Impasto");
		// Same game target cooks Windows PIE, Android APK/AAB, and iOS IPA.
	}
}
