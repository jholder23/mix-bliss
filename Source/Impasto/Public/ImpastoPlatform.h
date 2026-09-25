#pragma once

#include "CoreMinimal.h"
#include "RHI.h"
#include "RHIDefinitions.h"

/** Packaged Android/iOS, or an ES3.1 mobile preview. Desktop PIE stays on Lumen. */
inline bool ImpastoIsMobileTarget()
{
#if PLATFORM_ANDROID || PLATFORM_IOS
	return true;
#else
	return GIsRHIInitialized && GMaxRHIFeatureLevel == ERHIFeatureLevel::ES3_1;
#endif
}
