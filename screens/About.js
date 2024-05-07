import { View, Text, StyleSheet, Linking } from "react-native";
import { ScrollView } from "react-native-gesture-handler";

const AboutScreen = () => {
  return (
    <ScrollView style={styles.main}>
      <View style={styles.textContainer}>
        <Text style={styles.title}>Folger Shakespeare Library</Text>
        <Text
          style={styles.link}
          onPress={() =>
            Linking.openURL(
              "https://www.folger.edu/teach/resource/the-folger-shakespeare-api-tools/"
            )
          }
        >
          https://www.folger.edu/teach/resource/the-folger-shakespeare-api-tools/
        </Text>
        <Text
          style={styles.link}
          onPress={() =>
            Linking.openURL(
              "https://www.folgerdigitaltexts.org/api?_ga=2.166164670.1096109316.1715025640-1153892906.1712805817"
            )
          }
        >
          https://www.folgerdigitaltexts.org/api?_ga=2.166164670.1096109316.1715025640-1153892906.1712805817
        </Text>
        <Text
          style={styles.link}
          onPress={() =>
            Linking.openURL("https://creativecommons.org/licenses/by-nc/3.0/")
          }
        >
          https://creativecommons.org/licenses/by-nc/3.0/
        </Text>
        <Text style={styles.header}>Copyright Policy</Text>
        <Text style={styles.description}>
          "The texts of Shakespeare’s works found on this site are from the
          Folger Digital Texts collection. Folger Digital Texts is licensed
          under a Creative Commons Attribution-NonCommercial 3.0 Unported
          license. This means that anyone who wants to read, search, share,
          remix, transform, and build on Folger Digital Texts is free to do so,
          under two very important conditions: Attribution: Any time you create
          a new version or distribute Folger Digital Texts in a form other than
          the ones we make available here, you must credit Folger Digital Texts
          as the original source, provide a link to the Creative Commons
          license, and state whether any changes were made to the content.
          NonCommercial: It’s important to us that the resources we make freely
          available through Folger Digital Texts remain free. That means that
          you may not use the material from Folger Digital Texts for commercial
          purposes."
        </Text>
      </View>
      <Text style={styles.title}>Folger Shakespeare Library Images</Text>
      <Text
        style={styles.link}
        onPress={() =>
          Linking.openURL(
            "https://digitalcollections.folger.edu/reference_images"
          )
        }
      >
        https://digitalcollections.folger.edu/reference_images
      </Text>
      <Text
        style={styles.link}
        onPress={() =>
          Linking.openURL(
            "https://www.folger.edu/research/images-and-permissions/#permissions"
          )
        }
      >
        https://www.folger.edu/research/images-and-permissions/#permissions
      </Text>
      <Text style={styles.header}>
        Permissions to use Folger's digital collection
      </Text>
      <Text style={styles.description}>
        "Every item in our digital collections has a Rights section with
        copyright information. We do not charge permission or publication fees
        for images released under public domain or a CC0 license. If a copyright
        holder other than “Folger Shakespeare Library” is listed in the Rights
        section with an image, then we cannot grant permission for that image’s
        reuse. You will need to contact the copyright holder directly to request
        permission for reuse."
      </Text>
      <Text style={styles.title}>MIT Complete Works of Shakespeare</Text>
      <Text
        style={styles.link}
        onPress={() => Linking.openURL("https://shakespeare.mit.edu/")}
      >
        https://shakespeare.mit.edu/
      </Text>
      <Text
        style={styles.link}
        onPress={() =>
          Linking.openURL("https://github.com/TheMITTech/shakespeare/")
        }
      >
        https://github.com/TheMITTech/shakespeare/
      </Text>
      <Text style={styles.header}>Permissions to use MIT Shakespeare</Text>
      <Text style={styles.description}>
        "Welcome to the Web's first edition of the Complete Works of William
        Shakespeare. This site has offered Shakespeare's plays and poetry to the
        Internet community since 1993. For other Shakespeare resources, visit
        the Mr. William Shakespeare and the Internet Web site. The original
        electronic source for this server was the Complete Moby(tm) Shakespeare.
        The HTML versions of the plays provided here are placed in the public
        domain. 5/10/23: Current copy taken from
        https://github.com/TheMITTech/shakespeare/ and hosted by MIT IS&T in a
        static location."
      </Text>
      <Text style={styles.title}>Quizzes</Text>
      <Text style={styles.header}>Quizzes content</Text>
      <Text style={styles.description}>
        Quizzes questions and answers' content were generated by AI
      </Text>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  main: {
    flex: 1,
    backgroundColor: "black",
  },
  textContainer: {
    margin: 2,
  },
  title: {
    color: "white",
    fontSize: 22,
    fontFamily: "serif",
  },
  header: {
    color: "white",
    fontSize: 18,
    fontFamily: "sans-serif-light",
  },
  description: {
    color: "white",
    marginBottom: 18,
    fontFamily: "serif",
  },
  link: {
    color: "red",
    textDecorationLine: "underline",
  },
});

export default AboutScreen;
