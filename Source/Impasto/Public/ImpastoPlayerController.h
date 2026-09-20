#pragma once

#include "CoreMinimal.h"
#include "GameFramework/PlayerController.h"
#include "ImpastoPlayerController.generated.h"

UCLASS()
class IMPASTO_API AImpastoPlayerController : public APlayerController
{
	GENERATED_BODY()

public:
	AImpastoPlayerController();
	virtual void BeginPlay() override;
};
