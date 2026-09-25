#include "ImpastoMixerWidget.h"
#include "PaintStudioPawn.h"
#include "PaintSimComponent.h"
#include "Blueprint/WidgetTree.h"
#include "Components/SafeZone.h"
#include "Components/CanvasPanel.h"
#include "Components/CanvasPanelSlot.h"
#include "Components/VerticalBox.h"
#include "Components/VerticalBoxSlot.h"
#include "Components/HorizontalBox.h"
#include "Components/HorizontalBoxSlot.h"
#include "Components/UniformGridPanel.h"
#include "Components/UniformGridSlot.h"
#include "Components/SizeBox.h"
#include "Components/SizeBoxSlot.h"
#include "Components/Slider.h"
#include "Components/TextBlock.h"
#include "Components/CheckBox.h"
#include "Components/Border.h"
#include "Components/Spacer.h"
#include "Styling/CoreStyle.h"
#include "TimerManager.h"
#include "Engine/World.h"

namespace
{
	const FLinearColor ChromeBg(0.045f, 0.038f, 0.032f, 0.86f);
	const FLinearColor Cream(0.95f, 0.93f, 0.88f, 0.96f);
	const FLinearColor CreamDim(0.78f, 0.74f, 0.68f, 0.9f);

	FSlateFontInfo MakeFont(int32 Size, bool bBold)
	{
		return FCoreStyle::GetDefaultFontStyle(bBold ? TEXT("Bold") : TEXT("Regular"), Size);
	}

	FSlateBrush SolidBrush(const FLinearColor& Color, const FVector2D& Size)
	{
		FSlateBrush Brush;
		Brush.DrawAs = ESlateBrushDrawType::Box;
		Brush.TintColor = FSlateColor(Color);
		Brush.ImageSize = Size;
		return Brush;
	}

}

void UImpastoSwatchButton::HandleClicked()
{
	if (UImpastoMixerWidget* W = Mixer.Get())
	{
		W->SelectTube(TubeIndex);
	}
}

void UImpastoMixerWidget::NativeOnInitialized()
{
	Super::NativeOnInitialized();
	SetIsFocusable(false);
	SetVisibility(ESlateVisibility::SelfHitTestInvisible);
	BuildChrome();
}

void UImpastoMixerWidget::NativeConstruct()
{
	Super::NativeConstruct();
	RebuildSwatches();
	if (UWorld* World = GetWorld())
	{
		World->GetTimerManager().SetTimer(RefreshTimer, this, &UImpastoMixerWidget::RefreshStatus, 0.12f, true);
	}
	RefreshStatus();
}

void UImpastoMixerWidget::NativeDestruct()
{
	if (UWorld* World = GetWorld())
	{
		World->GetTimerManager().ClearTimer(RefreshTimer);
	}
	Super::NativeDestruct();
}

void UImpastoMixerWidget::BuildChrome()
{
	if (!WidgetTree)
	{
		return;
	}

	UCanvasPanel* Root = WidgetTree->ConstructWidget<UCanvasPanel>(UCanvasPanel::StaticClass(), TEXT("Root"));
	Root->SetVisibility(ESlateVisibility::SelfHitTestInvisible);
	WidgetTree->RootWidget = Root;

	USafeZone* Safe = WidgetTree->ConstructWidget<USafeZone>(USafeZone::StaticClass(), TEXT("Safe"));
	Safe->SetSidesToPad(true, true, false, true);
	Safe->SetVisibility(ESlateVisibility::SelfHitTestInvisible);
	if (UCanvasPanelSlot* SafeSlot = Root->AddChildToCanvas(Safe))
	{
		SafeSlot->SetAnchors(FAnchors(0.f, 1.f, 1.f, 1.f));
		SafeSlot->SetAlignment(FVector2D(0.5f, 1.f));
		SafeSlot->SetOffsets(FMargin(8.f, -18.f, 8.f, 10.f));
		SafeSlot->SetAutoSize(true);
	}

	Chrome = WidgetTree->ConstructWidget<UBorder>(UBorder::StaticClass(), TEXT("Chrome"));
	Chrome->SetBrushColor(ChromeBg);
	Chrome->SetPadding(FMargin(16.f, 14.f));
	Chrome->SetVisibility(ESlateVisibility::Visible);
	Safe->AddChild(Chrome);

	UVerticalBox* Col = WidgetTree->ConstructWidget<UVerticalBox>(UVerticalBox::StaticClass(), TEXT("Col"));
	Chrome->AddChild(Col);

	StatusLine = WidgetTree->ConstructWidget<UTextBlock>(UTextBlock::StaticClass(), TEXT("Status"));
	StatusLine->SetFont(MakeFont(18, true));
	StatusLine->SetColorAndOpacity(Cream);
	StatusLine->SetText(FText::FromString(TEXT("Cadmium Red")));
	if (UVerticalBoxSlot* S = Col->AddChildToVerticalBox(StatusLine))
	{
		S->SetPadding(FMargin(2.f, 0.f, 2.f, 8.f));
	}

	UHorizontalBox* Controls = WidgetTree->ConstructWidget<UHorizontalBox>(UHorizontalBox::StaticClass(), TEXT("Controls"));
	if (UVerticalBoxSlot* S = Col->AddChildToVerticalBox(Controls))
	{
		S->SetPadding(FMargin(0.f, 0.f, 0.f, 12.f));
	}

	FeelLine = WidgetTree->ConstructWidget<UTextBlock>(UTextBlock::StaticClass(), TEXT("Feel"));
	FeelLine->SetFont(MakeFont(15, false));
	FeelLine->SetColorAndOpacity(CreamDim);
	FeelLine->SetText(FText::FromString(TEXT("Impasto")));
	if (UHorizontalBoxSlot* S = Controls->AddChildToHorizontalBox(FeelLine))
	{
		S->SetPadding(FMargin(0.f, 0.f, 10.f, 0.f));
		S->SetVerticalAlignment(VAlign_Center);
	}

	USizeBox* SliderBox = WidgetTree->ConstructWidget<USizeBox>(USizeBox::StaticClass(), TEXT("SliderBox"));
	SliderBox->SetMinDesiredWidth(160.f);
	SliderBox->SetMinDesiredHeight(44.f);
	if (UHorizontalBoxSlot* S = Controls->AddChildToHorizontalBox(SliderBox))
	{
		FSlateChildSize Sz(ESlateSizeRule::Fill);
		Sz.Value = 1.f;
		S->SetSize(Sz);
		S->SetPadding(FMargin(4.f, 0.f));
		S->SetVerticalAlignment(VAlign_Center);
	}

	VisSlider = WidgetTree->ConstructWidget<USlider>(USlider::StaticClass(), TEXT("Viscosity"));
	VisSlider->SetMinValue(0.f);
	VisSlider->SetMaxValue(1.f);
	VisSlider->SetValue(0.72f);
	VisSlider->SetStepSize(0.02f);
	{
		FSliderStyle Style = VisSlider->GetWidgetStyle();
		Style.NormalThumbImage.ImageSize = FVector2D(36.f, 36.f);
		Style.HoveredThumbImage.ImageSize = FVector2D(36.f, 36.f);
		VisSlider->SetWidgetStyle(Style);
	}
	VisSlider->OnValueChanged.AddDynamic(this, &UImpastoMixerWidget::OnViscosityChanged);
	SliderBox->AddChild(VisSlider);

	UButton* Blank = WidgetTree->ConstructWidget<UButton>(UButton::StaticClass(), TEXT("Blank"));
	{
		FButtonStyle Style = Blank->GetStyle();
		Style.Normal = SolidBrush(FLinearColor(0.16f, 0.14f, 0.12f, 1.f), FVector2D(96.f, 48.f));
		Style.Hovered = SolidBrush(FLinearColor(0.22f, 0.19f, 0.16f, 1.f), FVector2D(96.f, 48.f));
		Style.Pressed = SolidBrush(FLinearColor(0.1f, 0.09f, 0.08f, 1.f), FVector2D(96.f, 48.f));
		Blank->SetStyle(Style);
	}
	Blank->OnClicked.AddDynamic(this, &UImpastoMixerWidget::OnBlankClicked);
	if (UHorizontalBoxSlot* S = Controls->AddChildToHorizontalBox(Blank))
	{
		S->SetPadding(FMargin(10.f, 0.f, 8.f, 0.f));
		S->SetVerticalAlignment(VAlign_Center);
	}
	UTextBlock* BlankLabel = WidgetTree->ConstructWidget<UTextBlock>(UTextBlock::StaticClass(), TEXT("BlankLabel"));
	BlankLabel->SetFont(MakeFont(16, true));
	BlankLabel->SetColorAndOpacity(Cream);
	BlankLabel->SetText(FText::FromString(TEXT("Blank")));
	Blank->AddChild(BlankLabel);

	ScraperBox = WidgetTree->ConstructWidget<UCheckBox>(UCheckBox::StaticClass(), TEXT("Knife"));
	ScraperBox->SetIsChecked(false);
	ScraperBox->OnCheckStateChanged.AddDynamic(this, &UImpastoMixerWidget::OnScraperChanged);
	if (UHorizontalBoxSlot* S = Controls->AddChildToHorizontalBox(ScraperBox))
	{
		S->SetPadding(FMargin(4.f, 0.f, 4.f, 0.f));
		S->SetVerticalAlignment(VAlign_Center);
	}
	UTextBlock* KnifeLabel = WidgetTree->ConstructWidget<UTextBlock>(UTextBlock::StaticClass(), TEXT("KnifeLabel"));
	KnifeLabel->SetFont(MakeFont(15, false));
	KnifeLabel->SetColorAndOpacity(CreamDim);
	KnifeLabel->SetText(FText::FromString(TEXT("Knife")));
	if (UHorizontalBoxSlot* S = Controls->AddChildToHorizontalBox(KnifeLabel))
	{
		S->SetVerticalAlignment(VAlign_Center);
	}

	SwatchGrid = WidgetTree->ConstructWidget<UUniformGridPanel>(UUniformGridPanel::StaticClass(), TEXT("Swatches"));
	SwatchGrid->SetSlotPadding(FMargin(6.f));
	SwatchGrid->SetMinDesiredSlotWidth(68.f);
	SwatchGrid->SetMinDesiredSlotHeight(68.f);
	if (UVerticalBoxSlot* S = Col->AddChildToVerticalBox(SwatchGrid))
	{
		S->SetPadding(FMargin(0.f, 2.f, 0.f, 0.f));
	}
}

APaintStudioPawn* UImpastoMixerWidget::GetStudio() const
{
	if (APlayerController* PC = GetOwningPlayer())
	{
		return Cast<APaintStudioPawn>(PC->GetPawn());
	}
	return nullptr;
}

void UImpastoMixerWidget::RebuildSwatches()
{
	if (!SwatchGrid || !WidgetTree)
	{
		return;
	}
	SwatchGrid->ClearChildren();
	SwatchFrames.Reset();
	Swatches.Reset();

	const APaintStudioPawn* Pawn = GetStudio();
	const UPaintSimComponent* Sim = Pawn ? Pawn->GetSim() : nullptr;
	const int32 Count = Sim ? Sim->GetTubes().Num() : 10;
	const int32 Cols = 5;

	for (int32 I = 0; I < Count; ++I)
	{
		UBorder* Frame = WidgetTree->ConstructWidget<UBorder>(UBorder::StaticClass(), *FString::Printf(TEXT("Frame%d"), I));
		Frame->SetPadding(FMargin(3.f));
		Frame->SetBrushColor(FLinearColor(1.f, 1.f, 1.f, I == 0 ? 1.f : 0.f));

		UImpastoSwatchButton* Btn = WidgetTree->ConstructWidget<UImpastoSwatchButton>(UImpastoSwatchButton::StaticClass(), *FString::Printf(TEXT("Tube%d"), I));
		Btn->TubeIndex = I;
		Btn->Mixer = this;
		FLinearColor Fill = FLinearColor(0.4f, 0.4f, 0.4f);
		if (Sim && Sim->GetTubes().IsValidIndex(I))
		{
			Fill = FLinearColor::FromSRGBColor(Sim->GetTubes()[I].Swatch);
		}
		FButtonStyle Style = Btn->GetStyle();
		Style.Normal = SolidBrush(Fill, FVector2D(68.f, 68.f));
		Style.Hovered = SolidBrush(Fill * 1.08f, FVector2D(68.f, 68.f));
		Style.Pressed = SolidBrush(Fill * 0.85f, FVector2D(68.f, 68.f));
		Btn->SetStyle(Style);
		Btn->OnClicked.AddDynamic(Btn, &UImpastoSwatchButton::HandleClicked);
		Frame->AddChild(Btn);

		USizeBox* Box = WidgetTree->ConstructWidget<USizeBox>(USizeBox::StaticClass(), *FString::Printf(TEXT("SwatchBox%d"), I));
		Box->SetWidthOverride(72.f);
		Box->SetHeightOverride(72.f);
		Box->AddChild(Frame);

		const int32 Row = I / Cols;
		const int32 Col = I % Cols;
		if (UUniformGridSlot* Slot = SwatchGrid->AddChildToUniformGrid(Box, Row, Col))
		{
			Slot->SetHorizontalAlignment(HAlign_Center);
			Slot->SetVerticalAlignment(VAlign_Center);
		}

		SwatchFrames.Add(Frame);
		Swatches.Add(Btn);
	}
}

void UImpastoMixerWidget::SyncSwatchSelection()
{
	const APaintStudioPawn* Pawn = GetStudio();
	const UPaintSimComponent* Sim = Pawn ? Pawn->GetSim() : nullptr;
	const int32 Selected = Sim ? Sim->GetSelectedTube() : 0;
	for (int32 I = 0; I < SwatchFrames.Num(); ++I)
	{
		if (SwatchFrames[I])
		{
			SwatchFrames[I]->SetBrushColor(FLinearColor(1.f, 1.f, 1.f, I == Selected ? 1.f : 0.f));
		}
	}
}

void UImpastoMixerWidget::SelectTube(int32 Index)
{
	if (APaintStudioPawn* Pawn = GetStudio())
	{
		Pawn->SelectTube(Index);
	}
	SyncSwatchSelection();
	RefreshStatus();
}

void UImpastoMixerWidget::OnBlankClicked()
{
	if (APaintStudioPawn* Pawn = GetStudio())
	{
		Pawn->BlankTray();
	}
}

void UImpastoMixerWidget::OnViscosityChanged(float Value)
{
	if (APaintStudioPawn* Pawn = GetStudio())
	{
		Pawn->SetViscosity(Value);
	}
}

void UImpastoMixerWidget::OnScraperChanged(bool bIsChecked)
{
	if (APaintStudioPawn* Pawn = GetStudio())
	{
		Pawn->SetScraperEnabled(bIsChecked);
	}
}

bool UImpastoMixerWidget::IsPointerOverChrome() const
{
	return Chrome && Chrome->IsHovered();
}

void UImpastoMixerWidget::RefreshStatus()
{
	const APaintStudioPawn* Pawn = GetStudio();
	const UPaintSimComponent* Sim = Pawn ? Pawn->GetSim() : nullptr;
	if (!Sim)
	{
		if (Swatches.Num() == 0)
		{
			RebuildSwatches();
		}
		return;
	}
	if (Swatches.Num() != Sim->GetTubes().Num())
	{
		RebuildSwatches();
	}

	const TArray<FImpastoTube>& Tubes = Sim->GetTubes();
	const FString Tube = Tubes.IsValidIndex(Sim->GetSelectedTube()) ? Tubes[Sim->GetSelectedTube()].Name.ToString() : TEXT("—");
	const FString Feel = Sim->GetViscositySlider() < 0.28f ? TEXT("Soft oil")
		: Sim->GetViscositySlider() < 0.55f ? TEXT("Heavy oil")
		: Sim->GetViscositySlider() < 0.8f ? TEXT("Impasto")
		: TEXT("Tar");
	if (StatusLine)
	{
		const FString Line = FString::Printf(
			TEXT("%s    ·    tap glop    ·    drag smear%s"),
			*Tube,
			Sim->IsSleeping() ? TEXT("    ·    still") : TEXT(""));
		StatusLine->SetText(FText::FromString(Line));
	}
	if (FeelLine)
	{
		FeelLine->SetText(FText::FromString(Feel));
	}
	if (VisSlider)
	{
		const float V = Sim->GetViscositySlider();
		if (!FMath::IsNearlyEqual(VisSlider->GetValue(), V, 0.005f))
		{
			VisSlider->SetValue(V);
		}
	}
	if (ScraperBox)
	{
		const bool bKnife = Pawn->IsScraperEnabled();
		if (ScraperBox->IsChecked() != bKnife)
		{
			ScraperBox->SetIsChecked(bKnife);
		}
	}
	SyncSwatchSelection();
}

