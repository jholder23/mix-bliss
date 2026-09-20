using UnrealBuildTool;

public class ImpastoEditor : ModuleRules
{
	public ImpastoEditor(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

		PrivateDependencyModuleNames.AddRange(new string[]
		{
			"Core",
			"CoreUObject",
			"Engine",
			"Impasto",
			"UnrealEd",
			"AssetRegistry",
			"AssetTools",
			"LevelEditor",
			"MaterialEditor"
		});
	}
}
