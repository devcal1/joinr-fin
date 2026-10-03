# kotlinx.serialization: keep the generated serializers of the app's @Serializable DTOs (the spike's rules).
-keepattributes *Annotation*, InnerClasses, Signature, EnclosingMethod
-dontnote kotlinx.serialization.**
-keepclassmembers class com.tenon.joinrfinance.** { *** Companion; }
-keepclasseswithmembers class com.tenon.joinrfinance.** { kotlinx.serialization.KSerializer serializer(...); }
-keep,includedescriptorclasses class com.tenon.joinrfinance.**$$serializer { *; }

# WorkManager instantiates the worker by name.
-keep class com.tenon.joinrfinance.work.RefreshWorker { <init>(...); }
