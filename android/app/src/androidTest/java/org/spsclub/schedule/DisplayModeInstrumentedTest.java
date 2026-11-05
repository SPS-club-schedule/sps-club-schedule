package org.spsclub.schedule;

import android.content.Context;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class DisplayModeInstrumentedTest {
    @Test public void modeSurvivesNewInstanceAndLogoutWithoutSavingInvalidModes(){
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        context.getSharedPreferences("display-mode",0).edit().clear().commit();
        try {
            DisplayMode mode=new DisplayMode(context);assertEquals("simple",mode.get());
            assertTrue(mode.set("full"));assertEquals("full",new DisplayMode(context).get());
            new SessionVault(context).clear();assertEquals("full",new DisplayMode(context).get());
            assertFalse(mode.set("https://evil.test"));assertEquals("full",mode.get());
            assertTrue(mode.set("simple"));assertEquals("simple",new DisplayMode(context).get());
        } finally {context.getSharedPreferences("display-mode",0).edit().clear().commit();}
    }
}
