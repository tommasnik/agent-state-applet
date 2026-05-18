plugins {
    id("org.jetbrains.intellij.platform") version "2.16.0"
    kotlin("jvm") version "2.2.0"
}

group = "com.github.agentfocus"
version = "1.0"

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    intellijPlatform {
        // Set IDEA_PATH env var or replace this with your local IntelliJ installation path.
        // Example (Toolbox): ~/.local/share/JetBrains/Toolbox/apps/intellij-idea-ultimate
        // Example (snap):    /snap/intellij-idea-ultimate/current
        local(System.getenv("IDEA_PATH") ?: error("Set IDEA_PATH to your IntelliJ installation directory"))
        bundledPlugin("org.jetbrains.plugins.terminal")
    }
}
