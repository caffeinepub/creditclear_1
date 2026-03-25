import Map "mo:core/Map";
import Text "mo:core/Text";
import Nat "mo:core/Nat";
import Iter "mo:core/Iter";
import Time "mo:core/Time";
import Runtime "mo:core/Runtime";
import List "mo:core/List";
import Principal "mo:core/Principal";
import Array "mo:core/Array";
import Order "mo:core/Order";
import AccessControl "authorization/access-control";
import MixinAuthorization "authorization/MixinAuthorization";

actor {
  // Initialize the access control system
  let accessControlState = AccessControl.initState();
  include MixinAuthorization(accessControlState);

  type Status = {
    #pending;
    #investigating;
    #resolved;
    #rejected;
  };

  type Client = {
    id : Nat;
    fullName : Text;
    email : Text;
    phone : Text;
    address : Text;
    cityStateZip : Text;
    ssnLast4 : Text;
    notes : Text;
    createdAt : Text;
    disputeCount : Nat;
    resolvedCount : Nat;
    status : Text;
  };

  type Dispute = {
    id : Nat;
    clientId : Nat;
    clientName : Text;
    account : Text;
    bureau : Text;
    reason : Text;
    status : Status;
    date : Text;
    daysLeft : Nat;
  };

  public type UserProfile = {
    name : Text;
  };

  type UserData = {
    clients : Map.Map<Nat, Client>;
    disputes : Map.Map<Nat, Dispute>;
    apiKey : ?Text;
    nextClientId : Nat;
    nextDisputeId : Nat;
  };

  module UserData {
    public func compareByClientCount(a : UserData, b : UserData) : Order.Order {
      Nat.compare(a.clients.size(), b.clients.size());
    };
  };

  module Client {
    public func compare(a : Client, b : Client) : Order.Order {
      Nat.compare(a.id, b.id);
    };
  };

  func timeToText(time : Time.Time) : Text {
    (time / 1000000000).toText();
  };

  let userData = Map.empty<Principal, UserData>();
  let userProfiles = Map.empty<Principal, UserProfile>();

  func getUserState(p : Principal) : UserData {
    switch (userData.get(p)) {
      case (?data) { data };
      case (null) {
        let newData : UserData = {
          clients = Map.empty<Nat, Client>();
          disputes = Map.empty<Nat, Dispute>();
          apiKey = null;
          nextClientId = 1;
          nextDisputeId = 1;
        };
        userData.add(p, newData);
        newData;
      };
    };
  };

  // User Profile Management Functions
  public query ({ caller }) func getCallerUserProfile() : async ?UserProfile {
    if (not (AccessControl.hasPermission(accessControlState, caller, #user))) {
      Runtime.trap("Unauthorized: Only users can view profiles");
    };
    userProfiles.get(caller);
  };

  public query ({ caller }) func getUserProfile(user : Principal) : async ?UserProfile {
    if (caller != user and not AccessControl.isAdmin(accessControlState, caller)) {
      Runtime.trap("Unauthorized: Can only view your own profile");
    };
    userProfiles.get(user);
  };

  public shared ({ caller }) func saveCallerUserProfile(profile : UserProfile) : async () {
    if (not (AccessControl.hasPermission(accessControlState, caller, #user))) {
      Runtime.trap("Unauthorized: Only users can save profiles");
    };
    userProfiles.add(caller, profile);
  };

  // Client Management Functions
  public shared ({ caller }) func addClient(clientInput : Client) : async Nat {
    if (not (AccessControl.hasPermission(accessControlState, caller, #user))) {
      Runtime.trap("Unauthorized: Only users can add clients");
    };
    let data = getUserState(caller);
    let id = data.nextClientId;
    let client : Client = {
      clientInput with
      id;
      createdAt = timeToText(Time.now());
      disputeCount = 0;
      resolvedCount = 0;
    };
    data.clients.add(id, client);
    userData.add(
      caller,
      {
        data with
        nextClientId = id + 1;
      },
    );
    id;
  };

  public shared ({ caller }) func updateClient(client : Client) : async () {
    if (not (AccessControl.hasPermission(accessControlState, caller, #user))) {
      Runtime.trap("Unauthorized: Only users can update clients");
    };
    let data = getUserState(caller);
    if (not data.clients.containsKey(client.id)) {
      Runtime.trap("Client not found");
    };
    data.clients.add(client.id, client);
  };

  public shared ({ caller }) func deleteClient(id : Nat) : async () {
    if (not (AccessControl.hasPermission(accessControlState, caller, #user))) {
      Runtime.trap("Unauthorized: Only users can delete clients");
    };
    let data = getUserState(caller);
    data.clients.remove(id);
  };

  public query ({ caller }) func getAllClients() : async [Client] {
    if (not (AccessControl.hasPermission(accessControlState, caller, #user))) {
      Runtime.trap("Unauthorized: Only users can view clients");
    };
    getUserState(caller).clients.values().toArray().sort();
  };

  // Dispute Management Functions
  public shared ({ caller }) func addDispute(disputeInput : Dispute) : async Nat {
    if (not (AccessControl.hasPermission(accessControlState, caller, #user))) {
      Runtime.trap("Unauthorized: Only users can add disputes");
    };
    let data = getUserState(caller);
    let id = data.nextDisputeId;
    let dispute : Dispute = {
      disputeInput with id;
      status = #pending;
    };
    data.disputes.add(id, dispute);
    userData.add(
      caller,
      {
        data with
        nextDisputeId = id + 1;
      },
    );
    id;
  };

  public shared ({ caller }) func updateDisputeStatus(id : Nat, status : Status) : async () {
    if (not (AccessControl.hasPermission(accessControlState, caller, #user))) {
      Runtime.trap("Unauthorized: Only users can update dispute status");
    };
    let data = getUserState(caller);
    switch (data.disputes.get(id)) {
      case (?dispute) {
        let updatedDispute = { dispute with status };
        data.disputes.add(id, updatedDispute);
      };
      case (null) { Runtime.trap("Dispute not found") };
    };
  };

  public shared ({ caller }) func deleteDispute(id : Nat) : async () {
    if (not (AccessControl.hasPermission(accessControlState, caller, #user))) {
      Runtime.trap("Unauthorized: Only users can delete disputes");
    };
    getUserState(caller).disputes.remove(id);
  };

  public query ({ caller }) func getAllDisputes() : async [Dispute] {
    if (not (AccessControl.hasPermission(accessControlState, caller, #user))) {
      Runtime.trap("Unauthorized: Only users can view disputes");
    };
    getUserState(caller).disputes.values().toArray();
  };

  // API Key Management Functions
  public shared ({ caller }) func setApiKey(key : Text) : async () {
    if (not (AccessControl.hasPermission(accessControlState, caller, #user))) {
      Runtime.trap("Unauthorized: Only users can set API keys");
    };
    let data = getUserState(caller);
    userData.add(
      caller,
      {
        data with
        apiKey = ?key;
      },
    );
  };

  public query ({ caller }) func getApiKey() : async ?Text {
    if (not (AccessControl.hasPermission(accessControlState, caller, #user))) {
      Runtime.trap("Unauthorized: Only users can view API keys");
    };
    getUserState(caller).apiKey;
  };
};
