#pragma once

#include "CoreMinimal.h"
#include "GameFramework/HUD.h"
#include "ImpastoHUD.generated.h"

UCLASS()
class IMPASTO_API AImpastoHUD : public AHUD
{
	GENERATED_BODY()

public:
	virtual void DrawHUD() override;
};
