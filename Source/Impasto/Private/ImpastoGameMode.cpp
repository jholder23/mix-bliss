#include "ImpastoGameMode.h"
#include "ImpastoPlayerController.h"
#include "ImpastoHUD.h"
#include "PaintStudioPawn.h"

AImpastoGameMode::AImpastoGameMode()
{
	DefaultPawnClass = APaintStudioPawn::StaticClass();
	PlayerControllerClass = AImpastoPlayerController::StaticClass();
	HUDClass = AImpastoHUD::StaticClass();
}
