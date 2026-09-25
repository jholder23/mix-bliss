#pragma once

#include "CoreMinimal.h"
#include "Blueprint/UserWidget.h"
#include "Components/Button.h"
#include "ImpastoMixerWidget.generated.h"

class USafeZone;
class UBorder;
class USlider;
class UTextBlock;
class UCheckBox;
class UUniformGridPanel;
class APaintStudioPawn;
class UImpastoMixerWidget;

/** Tube swatch that knows its index. UButton OnClicked is dynamic, so no lambdas. */
UCLASS()
class IMPASTO_API UImpastoSwatchButton : public UButton
{
	GENERATED_BODY()

public:
	int32 TubeIndex = 0;
	TWeakObjectPtr<UImpastoMixerWidget> Mixer;

	UFUNCTION()
	void HandleClicked();
};

/** Phone HUD: large tube swatches, viscosity, blank, optional knife. Safe-area bottom chrome. */
UCLASS()
class IMPASTO_API UImpastoMixerWidget : public UUserWidget
{
	GENERATED_BODY()

public:
	virtual void NativeOnInitialized() override;
	virtual void NativeConstruct() override;
	virtual void NativeDestruct() override;

	void SelectTube(int32 Index);
	bool IsPointerOverChrome() const;

protected:
	UFUNCTION()
	void OnBlankClicked();

	UFUNCTION()
	void OnViscosityChanged(float Value);

	UFUNCTION()
	void OnScraperChanged(bool bIsChecked);

	UFUNCTION()
	void RefreshStatus();

private:
	void BuildChrome();
	APaintStudioPawn* GetStudio() const;
	void RebuildSwatches();
	void SyncSwatchSelection();

	UPROPERTY()
	TObjectPtr<UBorder> Chrome;

	UPROPERTY()
	TObjectPtr<USlider> VisSlider;

	UPROPERTY()
	TObjectPtr<UTextBlock> StatusLine;

	UPROPERTY()
	TObjectPtr<UTextBlock> FeelLine;

	UPROPERTY()
	TObjectPtr<UCheckBox> ScraperBox;

	UPROPERTY()
	TObjectPtr<UUniformGridPanel> SwatchGrid;

	UPROPERTY()
	TArray<TObjectPtr<UBorder>> SwatchFrames;

	UPROPERTY()
	TArray<TObjectPtr<UImpastoSwatchButton>> Swatches;

	FTimerHandle RefreshTimer;
};
