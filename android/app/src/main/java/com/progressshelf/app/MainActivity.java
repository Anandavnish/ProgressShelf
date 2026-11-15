package com.progressshelf.app;

import android.content.res.Configuration;
import android.os.Build;
import android.os.Bundle;
import android.view.Window;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        applySystemBarsTheme();
    }

    @Override
    public void onResume() {
        super.onResume();
        applySystemBarsTheme();
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        applySystemBarsTheme();
    }

    public void applySystemBarsTheme() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            Window window = getWindow();
            int nightModeFlags = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
            boolean isNight = nightModeFlags == Configuration.UI_MODE_NIGHT_YES;
            int barColor = isNight ? 0xFF0D1117 : 0xFFFFFFFF;
            window.setNavigationBarColor(barColor);
            window.setStatusBarColor(barColor);

            WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
            if (controller != null) {
                controller.setAppearanceLightStatusBars(!isNight);
                controller.setAppearanceLightNavigationBars(!isNight);
            }
        }
    }
}
