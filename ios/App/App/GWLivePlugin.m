// GWLivePlugin.m — registers GWLivePlugin with Capacitor so the web layer
// can reach it as Capacitor.Plugins.GWLive. Keep in the App target.

#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(GWLivePlugin, "GWLive",
    CAP_PLUGIN_METHOD(update, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(start,  CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(end,    CAPPluginReturnPromise);
)
