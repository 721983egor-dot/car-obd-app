import { useState } from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { GarageScreen } from './src/screens/GarageScreen';
import { CarDetailScreen } from './src/screens/CarDetailScreen';
import { AddCarScreen } from './src/screens/AddCarScreen';
import { AddMaintenanceScreen } from './src/screens/AddMaintenanceScreen';
import { ObdScreen } from './src/screens/ObdScreen';
import { colors } from './src/ui/theme';

type Route =
  | { name: 'garage' }
  | { name: 'car'; carId: string }
  | { name: 'addCar' }
  | { name: 'addMaintenance'; carId: string }
  | { name: 'obd'; fromCarId?: string };

export default function App() {
  const [route, setRoute] = useState<Route>({ name: 'garage' });

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
        <StatusBar barStyle="light-content" />
        <View style={styles.body}>
          {route.name === 'garage' ? (
            <GarageScreen
              onOpenCar={(carId) => setRoute({ name: 'car', carId })}
              onAddCar={() => setRoute({ name: 'addCar' })}
              onOpenObd={() => setRoute({ name: 'obd' })}
            />
          ) : null}

          {route.name === 'car' ? (
            <CarDetailScreen
              carId={route.carId}
              onBack={() => setRoute({ name: 'garage' })}
              onAddMaintenance={() =>
                setRoute({ name: 'addMaintenance', carId: route.carId })
              }
              onOpenObd={() => setRoute({ name: 'obd', fromCarId: route.carId })}
            />
          ) : null}

          {route.name === 'addCar' ? (
            <AddCarScreen
              onBack={() => setRoute({ name: 'garage' })}
              onSaved={(carId) => setRoute({ name: 'car', carId })}
            />
          ) : null}

          {route.name === 'addMaintenance' ? (
            <AddMaintenanceScreen
              carId={route.carId}
              onBack={() => setRoute({ name: 'car', carId: route.carId })}
              onSaved={() => setRoute({ name: 'car', carId: route.carId })}
            />
          ) : null}

          {route.name === 'obd' ? (
            <ObdScreen
              onBack={() =>
                setRoute(
                  route.fromCarId
                    ? { name: 'car', carId: route.fromCarId }
                    : { name: 'garage' },
                )
              }
            />
          ) : null}
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1 },
});
