#include "ImpastoPlayerController.h"
#include "ImpastoMixerWidget.h"
#include "ImpastoPlatform.h"
#include "Blueprint/UserWidget.h"

AImpastoPlayerController::AImpastoPlayerController()
{
	bShowMouseCursor = true;
	bEnableClickEvents = true;
	bEnableMouseOverEvents = true;
	bEnableTouchEvents = true;
	bEnableTouchOverEvents = true;
	DefaultMouseCursor = EMouseCursor::Crosshairs;
}

void AImpastoPlayerController::BeginPlay()
{
	Super::BeginPlay();

	const bool bMobile = ImpastoIsMobileTarget();
	bShowMouseCursor = !bMobile;
	SetShowMouseCursor(!bMobile);

	FInputModeGameAndUI Mode;
	Mode.SetHideCursorDuringCapture(false);
	Mode.SetLockMouseToViewportBehavior(EMouseLockMode::DoNotLock);
	Mode.SetWidgetToFocus(nullptr);
	SetInputMode(Mode);

	CurrentClickTraceChannel = ECC_Visibility;
	ActivateTouchInterface(nullptr);

	SpawnMixerHud();
}

void AImpastoPlayerController::SpawnMixerHud()
{
	if (MixerWidget)
	{
		return;
	}
	MixerWidget = CreateWidget<UImpastoMixerWidget>(this, UImpastoMixerWidget::StaticClass());
	if (MixerWidget)
	{
		MixerWidget->AddToViewport(20);
	}
}

bool AImpastoPlayerController::IsPointerOverMixerHud() const
{
	return MixerWidget && MixerWidget->IsPointerOverChrome();
}
