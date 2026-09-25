#pragma once

#include "CoreMinimal.h"
#include "GameFramework/PlayerController.h"
#include "ImpastoPlayerController.generated.h"

class UImpastoMixerWidget;

UCLASS()
class IMPASTO_API AImpastoPlayerController : public APlayerController
{
	GENERATED_BODY()

public:
	AImpastoPlayerController();
	virtual void BeginPlay() override;

	bool IsPointerOverMixerHud() const;
	UImpastoMixerWidget* GetMixerWidget() const { return MixerWidget; }

private:
	void SpawnMixerHud();

	UPROPERTY()
	TObjectPtr<UImpastoMixerWidget> MixerWidget;
};
