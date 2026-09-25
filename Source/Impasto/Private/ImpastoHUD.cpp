#include "ImpastoHUD.h"

void AImpastoHUD::DrawHUD()
{
	Super::DrawHUD();
	// Tube chrome lives in UImpastoMixerWidget so it hits thumbs on a phone
	// and still works in editor PIE. Canvas swatches are gone on purpose.
}
