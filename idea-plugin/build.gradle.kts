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
        local("/home/tom/.local/share/JetBrains/Toolbox/apps/intellij-idea-ultimate")
        bundledPlugin("org.jetbrains.plugins.terminal")
    }
}
